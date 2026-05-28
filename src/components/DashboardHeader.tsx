"use client";

interface Props {
  phone: string;
  onDisconnect: () => void;
}

export default function DashboardHeader({ phone, onDisconnect }: Props) {
  const handleDisconnect = async () => {
    await fetch("/api/connection/disconnect", { method: "POST" });
    onDisconnect();
  };

  return (
    <header className="h-14 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="font-semibold text-gray-100">Agente WhatsApp</span>
        <span className="text-sm text-gray-400">conectado como {phone}</span>
      </div>
      <button
        onClick={handleDisconnect}
        className="px-3 py-1.5 rounded-lg text-sm bg-red-900 hover:bg-red-700 text-red-200 transition-colors"
      >
        Desconectar
      </button>
    </header>
  );
}
