/**
 * POST /api/connection/disconnect
 * Marca la sesión como desconectada en la DB.
 * El proceso bot detectará el cambio y hará logout de Baileys.
 * (En v1 no hay IPC directo; se usa la DB como canal de señales.)
 */
import { NextResponse } from "next/server";
import { setConnectionState, setRestartRequested } from "@/lib/db";
import { rm } from "fs/promises";
import path from "path";

export async function POST() {
  // Borrar auth files directamente desde el proceso web
  const authDir = path.join(process.cwd(), "auth");
  try { await rm(authDir, { recursive: true, force: true }); } catch {}

  // Señalizar al bot que cierre el socket actual y reconecte (va a generar QR porque no hay auth)
  setRestartRequested.run({ val: 1 });
  setConnectionState.run({ status: "connecting", qr_data: null, phone: null });
  return NextResponse.json({ ok: true });
}
