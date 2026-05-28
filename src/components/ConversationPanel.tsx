"use client";

import { useEffect, useRef, useState } from "react";
import type { Conversation, Message } from "@/lib/db";
import MessageBubble from "./MessageBubble";
import ModeToggle from "./ModeToggle";

interface Props {
  conversation: Conversation;
  onModeChange: (id: string, mode: "AI" | "HUMAN") => void;
  onDelete: (id: string) => void;
}

export default function ConversationPanel({ conversation, onModeChange, onDelete }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState<"AI" | "HUMAN">(conversation.mode);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Cargar mensajes y hacer polling cada 2s
  useEffect(() => {
    setMode(conversation.mode);
    loadMessages();
    const interval = setInterval(loadMessages, 2_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadMessages() {
    const res = await fetch(`/api/messages/${encodeURIComponent(conversation.id)}`);
    if (res.ok) {
      const data = await res.json() as Message[];
      setMessages(data);
    }
  }

  async function sendMessage() {
    if (!text.trim() || sending) return;
    setSending(true);
    await fetch(`/api/messages/${encodeURIComponent(conversation.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.trim() }),
    });
    setText("");
    await loadMessages();
    setSending(false);
  }

  async function handleDelete() {
    await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, {
      method: "DELETE",
    });
    onDelete(conversation.id);
    setConfirmDelete(false);
  }

  function handleModeChange(newMode: "AI" | "HUMAN") {
    setMode(newMode);
    onModeChange(conversation.id, newMode);
  }

  const displayName = conversation.name || conversation.id.split("@")[0];

  return (
    <div className="flex flex-col h-full">
      {/* Header del panel */}
      <div className="p-3 border-b border-gray-700 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-gray-600 flex items-center justify-center text-sm font-bold shrink-0">
            {displayName[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-gray-100 truncate">{displayName}</p>
            <p className="text-xs text-gray-400 truncate">{conversation.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ModeToggle
            conversationId={conversation.id}
            mode={mode}
            onModeChange={handleModeChange}
          />
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-2 py-1 rounded text-xs bg-red-900 hover:bg-red-700 text-red-200 transition-colors"
            >
              Borrar
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-400">¿Confirmar?</span>
              <button
                onClick={handleDelete}
                className="px-2 py-1 rounded text-xs bg-red-700 hover:bg-red-600 text-white"
              >
                Sí
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-200"
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-center text-gray-500 text-sm mt-8">Sin mensajes aún.</p>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            role={m.role}
            content={m.content}
            createdAt={m.created_at}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer (solo en modo HUMAN) */}
      {mode === "HUMAN" && (
        <div className="p-3 border-t border-gray-700 flex gap-2 shrink-0">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Escribe un mensaje como operador…"
            className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={sendMessage}
            disabled={sending || !text.trim()}
            className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            {sending ? "…" : "Enviar"}
          </button>
        </div>
      )}

      {mode === "AI" && (
        <div className="p-2 border-t border-gray-800 text-center text-xs text-gray-600">
          Modo IA activo — la IA responde automáticamente
        </div>
      )}
    </div>
  );
}
