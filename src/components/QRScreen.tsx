"use client";

interface Props {
  qrData: string | null; // Data URL PNG o null si todavía está generando
}

export default function QRScreen({ qrData }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 gap-6 p-8">
      <h1 className="text-2xl font-bold text-gray-100">Conectar WhatsApp</h1>
      <p className="text-gray-400 text-center max-w-sm">
        Abre WhatsApp en tu teléfono, toca{" "}
        <strong className="text-gray-200">Dispositivos vinculados</strong> y luego{" "}
        <strong className="text-gray-200">Vincular dispositivo</strong>.
      </p>

      <div className="w-72 h-72 bg-white rounded-2xl flex items-center justify-center shadow-2xl">
        {qrData ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrData}
            alt="Código QR de WhatsApp"
            className="w-64 h-64 rounded-xl"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <div className="w-10 h-10 border-4 border-gray-300 border-t-green-500 rounded-full animate-spin" />
            <span className="text-sm">Generando QR…</span>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-600 text-center max-w-xs">
        El bot debe estar corriendo (<code>npm run start:bot</code>). El QR se
        actualiza automáticamente.
      </p>
    </div>
  );
}
