/**
 * DELETE /api/conversations/[conversationId]
 * Borra una conversación y sus mensajes (CASCADE en SQLite).
 */
import { NextResponse } from "next/server";
import { deleteConversation } from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  deleteConversation.run({ id: conversationId });
  return NextResponse.json({ ok: true });
}
