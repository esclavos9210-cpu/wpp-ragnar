"use client";

interface Props {
  conversationId: string;
  mode: "AI" | "HUMAN";
  onModeChange: (mode: "AI" | "HUMAN") => void;
}

export default function ModeToggle({ conversationId, mode, onModeChange }: Props) {
  const toggle = async () => {
    const newMode = mode === "AI" ? "HUMAN" : "AI";
    await fetch(`/api/mode/${encodeURIComponent(conversationId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: newMode }),
    });
    onModeChange(newMode);
  };

  return (
    <button
      onClick={toggle}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
        mode === "AI"
          ? "bg-green-700 hover:bg-green-600 text-white"
          : "bg-yellow-600 hover:bg-yellow-500 text-white"
      }`}
    >
      {mode === "AI" ? "🤖 IA" : "👤 Humano"}
    </button>
  );
}
