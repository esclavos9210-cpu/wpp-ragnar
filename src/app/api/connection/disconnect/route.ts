/**
 * POST /api/connection/disconnect
 * Marca la sesión como desconectada en la DB.
 * El proceso bot detectará el cambio y hará logout de Baileys.
 * (En v1 no hay IPC directo; se usa la DB como canal de señales.)
 */
import { NextResponse } from "next/server";
import { setConnectionState, setRestartRequested } from "@/lib/db";
import { readdir, unlink } from "fs/promises";
import path from "path";

export async function POST() {
  // Borrar archivos de auth (sin borrar el directorio — es un volumen Docker y da EBUSY)
  const authDir = path.join(process.cwd(), "auth");
  try {
    const files = await readdir(authDir);
    await Promise.all(files.map(f => unlink(path.join(authDir, f)).catch(() => {})));
  } catch {}

  // El bot detecta esta señal y llama process.exit(0);
  // Docker reinicia el contenedor con auth vacío → genera QR nuevo
  setRestartRequested.run({ val: 1 });
  setConnectionState.run({ status: "connecting", qr_data: null, phone: null });
  return NextResponse.json({ ok: true });
}
