/**
 * scripts/start-bot.ts
 * Punto de entrada del proceso bot.
 * CRÍTICO: env-loader DEBE ser el primer import.
 */
import "./env-loader"; // <- carga .env.local ANTES que todo

import { startBaileyClient } from "../src/lib/baileys/client";
import { drainOutbox } from "../src/lib/baileys/handler";
import { getRestartRequested, setRestartRequested } from "../src/lib/db";

console.log("[bot] Iniciando agente WhatsApp…");

// Cierre limpio ante SIGTERM (Docker stop) o SIGINT (Ctrl+C)
const gracefulShutdown = (signal: string) => {
  console.log(`[bot] ${signal} recibido — cerrando limpiamente…`);
  process.exit(0);
};
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

// Drena el outbox cada 5 segundos (mensajes del dashboard)
setInterval(() => { void drainOutbox(); }, 5_000);

// Escucha señal de reconexión del dashboard cada 3 segundos
setInterval(() => {
  const row = getRestartRequested.get();
  if (row?.restart_requested) {
    setRestartRequested.run({ val: 0 });
    console.log("[bot] Señal de reconexión — reiniciando servicio…");
    process.exit(0); // Docker restart policy reinicia el contenedor con auth vacío → QR nuevo
  }
}, 3_000);

startBaileyClient().catch((err) => {
  console.error("[bot] Error fatal:", err);
  process.exit(1);
});
