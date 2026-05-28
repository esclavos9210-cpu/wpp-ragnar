/**
 * POST /api/connection/disconnect
 * Marca la sesión como desconectada en la DB.
 * El proceso bot detectará el cambio y hará logout de Baileys.
 * (En v1 no hay IPC directo; se usa la DB como canal de señales.)
 */
import { NextResponse } from "next/server";
import { setConnectionState, setRestartRequested } from "@/lib/db";

export async function POST() {
  // Señalizar al proceso bot que se reconecte y genere nuevo QR
  setRestartRequested.run({ val: 1 });
  setConnectionState.run({ status: "connecting", qr_data: null, phone: null });
  return NextResponse.json({ ok: true });
}
