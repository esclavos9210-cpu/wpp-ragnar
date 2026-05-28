interface Props {
  role: "user" | "bot" | "human";
  content: string;
  createdAt: number; // unix timestamp
}

export default function MessageBubble({ role, content, createdAt }: Props) {
  const date = new Date(createdAt * 1000);
  const time = date.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isOutgoing = role === "bot" || role === "human";

  const bubbleClass = isOutgoing
    ? role === "bot"
      ? "bg-green-800 text-green-50 self-end"
      : "bg-blue-700 text-blue-50 self-end"
    : "bg-gray-700 text-gray-100 self-start";

  const label =
    role === "bot" ? "🤖 Bot" : role === "human" ? "👤 Operador" : "💬 Cliente";

  return (
    <div className={`flex flex-col max-w-[75%] ${isOutgoing ? "items-end self-end" : "items-start self-start"}`}>
      <span className="text-xs text-gray-400 mb-0.5 px-1">{label}</span>
      <div className={`rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${bubbleClass}`}>
        {content}
      </div>
      <span className="text-xs text-gray-500 mt-0.5 px-1">{time}</span>
    </div>
  );
}
