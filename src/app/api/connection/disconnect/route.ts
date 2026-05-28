/**
 * POST /api/connection/disconnect
 * Marca la sesión como desconectada en la DB.
 * El proceso bot detectará el cambio y hará logout de Baileys.
 * (En v1 no hay IPC directo; se usa la DB como canal de señales.)
 */
import { NextResponse } from "next/server";
import { setConnectionState } from "@/lib/db";
import fs from "fs";
import path from "path";

export async function POST() {
  // Borrar archivos de auth para forzar nuevo QR en el próximo arranque del bot
  const authDir = path.join(process.cwd(), "auth");
  try {
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
  } catch {
    // ignorar errores de permisos
  }

  setConnectionState.run({ status: "disconnected", qr_data: null, phone: null });
  return NextResponse.json({ ok: true });
}
