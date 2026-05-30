/**
 * src/lib/baileys/handler.ts
 * Procesa mensajes entrantes y drena el outbox.
 */
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { getContentType } from "@whiskeysockets/baileys";
import {
  upsertConversation,
  insertMessage,
  touchConversation,
  getConversationById,
  getRecentMessages,
  getPendingOutbox,
  markOutboxSent,
} from "../db";
import { getChatResponse } from "../openrouter";

const HISTORY_LIMIT = 20;

/** Procesa un mensaje entrante de WhatsApp. */
export async function handleIncomingMessage(
  msg: WAMessage,
  sock: WASocket
): Promise<void> {
  console.log(
    `[handler] fromMe=${msg.key.fromMe} jid=${msg.key.remoteJid} stub=${msg.messageStubType ?? "none"} hasMsg=${!!msg.message}`
  );

  // Ignorar mensajes propios
  if (msg.key.fromMe) return;

  // Ignorar mensajes sin JID o mensajes de estado/broadcast
  const rawJid = msg.key.remoteJid;
  if (!rawJid) return;
  if (rawJid === "status@broadcast") return;

  // Ignorar grupos
  if (rawJid.endsWith("@g.us")) return;

  // Ignorar mensajes de protocolo (sin contenido real)
  if (msg.messageStubType) return;
  if (!msg.message) return;

  // ─── Extraer texto ──────────────────────────────────────────────────────
  const contentType = getContentType(msg.message);
  let text: string | null = null;

  if (contentType === "conversation") {
    text = msg.message.conversation ?? null;
  } else if (contentType === "extendedTextMessage") {
    text = msg.message.extendedTextMessage?.text ?? null;
  } else if (contentType === "imageMessage") {
    text = msg.message.imageMessage?.caption ?? null;
  } else if (contentType === "videoMessage") {
    text = msg.message.videoMessage?.caption ?? null;
  } else if (contentType === "buttonsResponseMessage") {
    text = msg.message.buttonsResponseMessage?.selectedDisplayText ?? null;
  } else if (contentType === "listResponseMessage") {
    text = msg.message.listResponseMessage?.title ?? null;
  }

  console.log(`[handler] jid=${rawJid} contentType=${contentType} text="${text}"`);
  if (!text) return;

  // ─── Resolver JID para envío ────────────────────────────────────────────
  // Para @lid: intentar resolver de forma asíncrona (espera hasta 4s)
  const { resolveLidAsync } = await import("./client");
  const sendJid = await resolveLidAsync(rawJid, 4_000);

  // JID normalizado para la DB (siempre @s.whatsapp.net o @lid si no se resolvió)
  const dbJid = sendJid.endsWith("@lid")
    ? sendJid.replace("@lid", "@s.whatsapp.net")  // fallback: conservar como clave única
    : sendJid;

  console.log(`[handler] sendJid=${sendJid} dbJid=${dbJid}`);

  const pushName = msg.pushName ?? "";

  // ─── DB: guardar conversación y mensaje del usuario ────────────────────
  upsertConversation.run({ id: dbJid, name: pushName });
  touchConversation.run({ id: dbJid });
  insertMessage.run({ conversation_id: dbJid, role: "user", content: text });
  console.log(`[handler] [${dbJid}] user: ${text}`);

  // ─── Modo HUMAN: solo guardar, no responder ─────────────────────────────
  const conv = getConversationById.get({ id: dbJid });
  if (!conv || conv.mode !== "AI") return;

  // ─── Historial para el LLM ──────────────────────────────────────────────
  const rawHistory = getRecentMessages.all({
    conversation_id: dbJid,
    limit: HISTORY_LIMIT,
  });
  // Viene DESC (más reciente primero); invertir, excluir el último (recién insertado)
  const history = rawHistory
    .reverse()
    .slice(0, -1)
    .map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));

  let response: string | null = null;

  const { getSocket } = await import("./client");

  try {
    response = await getChatResponse(history, text, undefined, pushName || undefined, dbJid);
    if (!response) {
      console.warn(`[handler] respuesta vacía del LLM para jid=${dbJid}, se descarta`);
      return;
    }
  } catch (err: unknown) {
    console.error(`[handler] Error en getChatResponse para jid=${dbJid}:`, err);
    response = "Disculpa, tuve un inconveniente. ¿Puedes intentarlo de nuevo? 🙏";
  }

  insertMessage.run({ conversation_id: dbJid, role: "bot", content: response });

  try {
    const activeSock = getSocket() ?? sock;
    console.log(`[handler] enviando a ${sendJid}…`);
    await activeSock.sendMessage(sendJid, { text: response });
    console.log(`[handler] enviado ✓ → ${sendJid}: ${response}`);
    return;
  } catch (err: unknown) {
    const errCode = (err as { output?: { statusCode?: number } })?.output?.statusCode;
    console.error(`[handler] Error enviando a ${sendJid} (código ${errCode ?? "?"}):`, err);
  }

  // Fallback: si el JID resuelto falló y el original era @lid, intentar con @lid directo
  if (response && sendJid !== rawJid && rawJid.endsWith("@lid")) {
    console.warn(`[handler] intentando fallback @lid → ${rawJid}`);
    try {
      const { getSocket } = await import("./client");
      const activeSock = getSocket() ?? sock;
      await activeSock.sendMessage(rawJid, { text: response });
      console.log(`[handler] enviado ✓ (fallback @lid) → ${rawJid}`);
    } catch (err2) {
      console.error(`[handler] Fallback @lid también falló:`, err2);
    }
  } else if (response && rawJid.endsWith("@lid") && sendJid === rawJid) {
    console.error(
      `[handler] No se pudo enviar. @lid sin mapeo. lidToJid.size podría ser 0. ` +
        `Revisa logs de [baileys] contacts.upsert para este JID: ${rawJid}`
    );
  }
}

/**
 * Drena el outbox: envía mensajes que el dashboard puso en cola
 * (modo HUMAN o mensajes manuales del operador).
 */
export async function drainOutbox(): Promise<void> {
  const { getSocket } = await import("./client");
  const socket = getSocket();
  if (!socket) return;

  const pending = getPendingOutbox.all();
  for (const item of pending) {
    try {
      await socket.sendMessage(item.conversation_id, { text: item.content });
      markOutboxSent.run({ id: item.id });
      console.log(`[outbox] enviado a ${item.conversation_id}: ${item.content}`);
    } catch (err) {
      console.error(`[outbox] error enviando item ${item.id}:`, err);
    }
  }
}
