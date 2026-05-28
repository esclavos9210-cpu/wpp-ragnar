"use client";

import { useEffect, useState } from "react";
import QRScreen from "./QRScreen";
import DashboardHeader from "./DashboardHeader";
import ConversationList from "./ConversationList";
import ConversationPanel from "./ConversationPanel";
import type { Conversation } from "@/lib/db";

interface ConnectionStatus {
  status: "disconnected" | "connecting" | "connected";
  qr_data: string | null;
  phone: string | null;
}

export default function ConnectionGate() {
  const [conn, setConn] = useState<ConnectionStatus>({
    status: "disconnected",
    qr_data: null,
    phone: null,
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Polling al status y conversaciones cada 2s
  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, 2_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pollStatus() {
    try {
      const [statusRes, convsRes] = await Promise.all([
        fetch("/api/connection/status"),
        fetch("/api/conversations"),
      ]);
      if (statusRes.ok) {
        const data = await statusRes.json() as ConnectionStatus;
        setConn(data);
      }
      if (convsRes.ok) {
        const data = await convsRes.json() as Conversation[];
        setConversations(data);
      }
    } catch {
      // silenciar errores de red transitorios
    }
  }

  function handleDisconnect() {
    setConn({ status: "disconnected", qr_data: null, phone: null });
    setSelectedId(null);
  }

  function handleModeChange(id: string, mode: "AI" | "HUMAN") {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, mode } : c))
    );
  }

  function handleDelete(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  // Pantalla de QR (no conectado o conectando)
  if (conn.status !== "connected") {
    return <QRScreen qrData={conn.qr_data} />;
  }

  // Dashboard principal
  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex flex-col h-screen">
      <DashboardHeader
        phone={conn.phone ?? "desconocido"}
        onDisconnect={handleDisconnect}
      />
      <div className="flex flex-1 overflow-hidden">
        {/* Panel izquierdo: lista de conversaciones */}
        <aside className="w-72 border-r border-gray-700 flex flex-col shrink-0 overflow-hidden">
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>

        {/* Panel derecho: conversación seleccionada */}
        <main className="flex-1 overflow-hidden">
          {selectedConv ? (
            <ConversationPanel
              conversation={selectedConv}
              onModeChange={handleModeChange}
              onDelete={handleDelete}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              Selecciona una conversación para empezar
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
