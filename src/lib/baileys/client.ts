/**
 * src/lib/baileys/client.ts
 * Gestiona el ciclo de vida de la conexión WhatsApp via Baileys.
 */
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import path from "path";
import { setConnectionState } from "../db";
import { handleIncomingMessage, drainOutbox } from "./handler";

const AUTH_DIR = path.join(process.cwd(), "auth");

let sock: WASocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;
let _manualReconnect = false;

// Mapa LID → JID real (@s.whatsapp.net)
// Se rellena desde contacts.upsert, contacts.update y messaging-history.set
const lidToJid = new Map<string, string>();

/** Normaliza un LID a formato "number@lid" para claves consistentes en el mapa */
function normalizeLid(lid: string): string {
  return lid.endsWith("@lid") ? lid : `${lid}@lid`;
}

/** Registra una asociación LID → JID en el mapa (ambas direcciones de formato) */
function mapContact(lid: string, jid: string): void {
  if (!lid || !jid) return;
  const normalizedLid = normalizeLid(lid);
  if (!lidToJid.has(normalizedLid)) {
    lidToJid.set(normalizedLid, jid);
    console.log(`[baileys] contacto mapeado: ${normalizedLid} → ${jid}`);
  }
}

export function getSocket(): WASocket | null {
  return sock;
}

/**
 * Resuelve un JID @lid al JID real @s.whatsapp.net.
 * Si no hay mapeo, devuelve el @lid original (Baileys 6.7+ puede enrutarlo internamente).
 */
export function resolveJid(jid: string): string {
  if (!jid.endsWith("@lid")) return jid;
  const normalized = normalizeLid(jid);
  const resolved = lidToJid.get(normalized);
  if (resolved) {
    console.log(`[baileys] LID resuelto: ${normalized} → ${resolved}`);
    return resolved;
  }
  console.warn(`[baileys] LID sin mapeo: ${normalized} (lidToJid.size=${lidToJid.size})`);
  return jid; // devolver @lid — Baileys lo enruta internamente en WA Business
}

/**
 * Espera hasta timeoutMs a que un LID tenga mapeo en el mapa de contactos.
 * Útil cuando el mensaje llega antes de que contacts.upsert haya procesado el contacto.
 */
export async function resolveLidAsync(
  jid: string,
  timeoutMs = 4_000
): Promise<string> {
  if (!jid.endsWith("@lid")) return jid;
  const normalized = normalizeLid(jid);
  const interval = 200;
  let elapsed = 0;
  while (elapsed < timeoutMs) {
    const resolved = lidToJid.get(normalized);
    if (resolved) return resolved;
    await new Promise((r) => setTimeout(r, interval));
    elapsed += interval;
  }
  console.warn(`[baileys] resolveLidAsync timeout para ${normalized}`);
  return jid;
}

export async function startBaileyClient(): Promise<void> {
  reconnectAttempts = 0;
  await connect();
}

async function connect(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  // Cache local para getMessage — necesario para descifrar mensajes de WA Business (@lid)
  const msgCache = new Map<string, proto.IWebMessageInfo>();

  sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.macOS("Desktop"),
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    retryRequestDelayMs: 250,        // retry más rápido → menor ventana de CIPHERTEXT
    markOnlineOnConnect: false,      // no mostrar "en línea" — evita conflictos de sesión WA Business
    syncFullHistory: true,           // sincronizar historial completo → necesario para establecer sesiones Signal con WA Business
    getMessage: async (key) => {
      const cached = msgCache.get(`${key.remoteJid}:${key.id}`);
      return cached?.message ?? undefined;
    },
  });

  // Cache de mensajes para getMessage
  sock.ev.on("messages.upsert", ({ messages }) => {
    for (const m of messages) {
      if (m.key.id) {
        msgCache.set(`${m.key.remoteJid}:${m.key.id}`, m);
      }
    }
  });

  // ─── Conexión ─────────────────────────────────────────────────────────────

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { width: 400 });
      qrcodeTerminal.generate(qr, { small: true });
      console.log("[baileys] QR generado — escanéalo desde localhost:3000");
      setConnectionState.run({ status: "connecting", qr_data: dataUrl, phone: null });
    }

    if (connection === "open") {
      reconnectAttempts = 0;
      const phone = sock?.user?.id?.split(":")[0] ?? null;
      console.log(`[baileys] Conectado como ${phone}`);
      setConnectionState.run({ status: "connected", qr_data: null, phone });
      void drainOutbox();
    }

    if (connection === "close") {
      const boom = lastDisconnect?.error as Boom | undefined;
      const reason = boom?.output?.statusCode;

      // 440 = connectionReplaced — otra sesión activa, esperar 15s antes de reconectar
      const isReplaced = reason === 440;
      const isLoggedOut = reason === DisconnectReason.loggedOut;

      console.warn(`[baileys] Conexión cerrada. Razón: ${reason}`);

      // Si hay un forceReconnect en curso, ignorar eventos de cierre — él maneja la reconexión
      if (_manualReconnect) return;

      if (isLoggedOut) {
        // Sesión cerrada desde el teléfono: borrar auth y reconectar para mostrar nuevo QR
        // El evento loggedOut llega DESPUÉS de que creds.update ya guardó — borrar ahora es seguro
        console.log("[baileys] Logout detectado — borrando auth y reconectando para nuevo QR…");
        sock = null;
        const { rm } = await import("fs/promises");
        try { await rm(AUTH_DIR, { recursive: true, force: true }); } catch {}
        reconnectAttempts = 0;
        setConnectionState.run({ status: "connecting", qr_data: null, phone: null });
        setTimeout(connect, 2_000);
      } else if (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        const delay = isReplaced ? 15_000 : reconnectAttempts * 3_000;
        console.log(
          `[baileys] Reconectando en ${delay / 1000}s (intento ${reconnectAttempts}/${MAX_RECONNECT})…`
        );
        setConnectionState.run({ status: "connecting", qr_data: null, phone: null });
        sock = null;
        setTimeout(connect, delay);
      } else {
        // Auth probablemente inválido — limpiar y generar nuevo QR en lugar de rendirse
        console.warn("[baileys] Máximo de reintentos alcanzado — limpiando auth para generar QR.");
        const { rm } = await import("fs/promises");
        try { await rm(AUTH_DIR, { recursive: true, force: true }); } catch {}
        sock = null;
        reconnectAttempts = 0;
        setConnectionState.run({ status: "connecting", qr_data: null, phone: null });
        setTimeout(connect, 2_000);
      }
    }
  });

  // ─── Credenciales ─────────────────────────────────────────────────────────
  sock.ev.on("creds.update", saveCreds);

  // ─── Mapa LID → JID real (contacts.upsert) ────────────────────────────────
  sock.ev.on("contacts.upsert", (contacts) => {
    console.log(`[baileys] contacts.upsert: ${contacts.length} contactos`);
    for (const c of contacts) {
      // Log completo para debugging
      console.log(`[baileys] contacto: id=${c.id} lid=${c.lid ?? "-"} name=${c.name ?? c.notify ?? "-"}`);

      if (c.lid && c.id) {
        // c.id = phone@s.whatsapp.net, c.lid = number@lid (o sin sufijo)
        if (!c.id.endsWith("@lid")) {
          mapContact(c.lid, c.id);
        } else {
          // c.id es @lid, c.lid podría ser el phone JID
          mapContact(c.id, c.lid);
        }
      }

      // Si c.id mismo tiene @lid format y no hay c.lid, registrar igualmente
      if (c.id.endsWith("@lid") && !c.lid) {
        console.log(`[baileys] @lid sin par: ${c.id}`);
      }
    }
  });

  sock.ev.on("contacts.update", (updates) => {
    for (const c of updates) {
      if (c.lid && c.id) {
        if (!c.id.endsWith("@lid")) {
          mapContact(c.lid, c.id);
        } else {
          mapContact(c.id, c.lid);
        }
      }
    }
  });

  // ─── Mapa LID desde historial (firing al conectar) ─────────────────────────
  // messaging-history.set se dispara al cargar el historial de chats/contactos
  sock.ev.on("messaging-history.set", ({ contacts = [], chats = [] }) => {
    console.log(`[baileys] messaging-history.set: ${contacts.length} contactos, ${chats.length} chats`);
    for (const c of contacts) {
      if (c.lid && c.id && !c.id.endsWith("@lid")) {
        mapContact(c.lid, c.id);
      }
    }
    // Los chats también pueden tener LID como id
    for (const chat of chats) {
      const chatId = chat.id as string;
      if (chatId?.endsWith("@lid")) {
        console.log(`[baileys] chat @lid: ${chatId}`);
      }
    }
  });

  // ─── Mensajes entrantes ───────────────────────────────────────────────────
  // Solo procesar type=notify (mensajes en tiempo real).
  // type=append son mensajes históricos del sync inicial — ignorarlos.
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    console.log(`[baileys] messages.upsert type=${type} count=${messages.length}`);
    if (type !== "notify") return;
    for (const msg of messages) {
      await handleIncomingMessage(msg, sock!);
    }
  });
}

/**
 * Fuerza desconexión, borra auth y genera nuevo QR.
 * Usado cuando el dashboard solicita reconexión.
 */
export async function forceReconnect(): Promise<void> {
  if (_manualReconnect) return;
  _manualReconnect = true;
  console.log("[baileys] forceReconnect: desconectando y generando nuevo QR…");

  if (sock) {
    // logout() invalida la sesión en WhatsApp y dispara creds.update (saveCreds escribe el estado)
    // Hay que esperar a que termine para que el saveCreds no restaure los archivos después de borrarlos
    try { await sock.logout(); } catch {}
    sock = null;
  }

  // Ahora que saveCreds ya terminó, borrar auth para forzar QR nuevo
  const { rm } = await import("fs/promises");
  try { await rm(AUTH_DIR, { recursive: true, force: true }); } catch {}

  reconnectAttempts = 0;
  setConnectionState.run({ status: "connecting", qr_data: null, phone: null });
  await new Promise<void>((r) => setTimeout(r, 500));
  _manualReconnect = false;
  void connect();
}

/**
 * Desconecta la sesión activa y borra los archivos de auth.
 */
export async function disconnectAndClear(): Promise<void> {
  if (sock) {
    try {
      await sock.logout();
    } catch {
      // ignorar errores al hacer logout
    }
    sock = null;
  }
  const { rm } = await import("fs/promises");
  try {
    await rm(AUTH_DIR, { recursive: true, force: true });
  } catch {
    // ignorar si ya no existe
  }
  setConnectionState.run({ status: "disconnected", qr_data: null, phone: null });
}
