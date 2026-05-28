/**
 * GET /api/connection/status
 * Devuelve el estado de la conexión Baileys y el QR si está disponible.
 * El dashboard hace polling a este endpoint cada 2 segundos.
 */
import { NextResponse } from "next/server";
import { getConnectionState } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  const state = getConnectionState.get();
  return NextResponse.json(
    state ?? { status: "disconnected", qr_data: null, phone: null }
  );
}
