"use client";

import type { Conversation } from "@/lib/db";

interface Props {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function ConversationList({ conversations, selectedId, onSelect }: Props) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b border-gray-700 text-sm font-semibold text-gray-300">
          Conversaciones
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm px-4 text-center">
          Sin conversaciones aún. Cuando alguien escriba al WhatsApp aparecerá aquí.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-700 text-sm font-semibold text-gray-300">
        Conversaciones ({conversations.length})
      </div>
      <ul className="flex-1 overflow-y-auto scrollbar-thin">
        {conversations.map((conv) => {
          const isSelected = conv.id === selectedId;
          const date = new Date(conv.last_msg_at * 1000);
          const timeStr = date.toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          });
          return (
            <li
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`p-3 cursor-pointer border-b border-gray-800 hover:bg-gray-800 transition-colors ${
                isSelected ? "bg-gray-800 border-l-2 border-l-green-500" : ""
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="font-medium text-sm text-gray-100 truncate max-w-[140px]">
                  {conv.name || conv.id.split("@")[0]}
                </span>
                <span className="text-xs text-gray-500 shrink-0">{timeStr}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                    conv.mode === "AI"
                      ? "bg-green-900 text-green-300"
                      : "bg-yellow-900 text-yellow-300"
                  }`}
                >
                  {conv.mode === "AI" ? "IA" : "Human"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
