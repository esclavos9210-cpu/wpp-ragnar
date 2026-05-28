/**
 * GET /api/conversations
 * Lista todas las conversaciones ordenadas por último mensaje.
 */
import { NextResponse } from "next/server";
import { getConversations } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  const convs = getConversations.all();
  return NextResponse.json(convs);
}
