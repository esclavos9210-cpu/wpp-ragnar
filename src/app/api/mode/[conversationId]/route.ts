/**
 * POST /api/mode/[conversationId]
 * Cambia el modo de la conversación entre AI y HUMAN.
 * Body: { mode: "AI" | "HUMAN" }
 */
import { NextResponse } from "next/server";
import { setConversationMode, type ConversationMode } from "@/lib/db";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  const { mode } = (await req.json()) as { mode: ConversationMode };

  if (mode !== "AI" && mode !== "HUMAN") {
    return NextResponse.json({ error: "mode debe ser AI o HUMAN" }, { status: 400 });
  }

  setConversationMode.run({ id: conversationId, mode });
  return NextResponse.json({ ok: true, mode });
}
