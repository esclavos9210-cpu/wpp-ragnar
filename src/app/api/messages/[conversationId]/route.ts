/**
 * GET  /api/messages/[conversationId]  — lista mensajes
 * POST /api/messages/[conversationId]  — envía mensaje como "human" (modo HUMAN)
 */
import { NextResponse } from "next/server";
import {
  getMessages,
  insertMessage,
  touchConversation,
  enqueueOutbox,
  getConversationById,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  const msgs = getMessages.all({ conversation_id: conversationId });
  return NextResponse.json(msgs);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  const { content } = (await req.json()) as { content: string };

  if (!content?.trim()) {
    return NextResponse.json({ error: "content vacío" }, { status: 400 });
  }

  const conv = getConversationById.get({ id: conversationId });
  if (!conv) {
    return NextResponse.json({ error: "conversación no encontrada" }, { status: 404 });
  }

  // Guardar en DB
  insertMessage.run({ conversation_id: conversationId, role: "human", content });
  touchConversation.run({ id: conversationId });

  // Encolar en outbox para que el bot lo envíe por WhatsApp
  enqueueOutbox.run({ conversation_id: conversationId, content, role: "human" });

  return NextResponse.json({ ok: true });
}
