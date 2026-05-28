/**
 * scripts/start-bot.ts
 * Punto de entrada del proceso bot.
 * CRÍTICO: env-loader DEBE ser el primer import.
 */
import "./env-loader"; // <- carga .env.local ANTES que todo

import { startBaileyClient } from "../src/lib/baileys/client";
import { drainOutbox } from "../src/lib/baileys/handler";

console.log("[bot] Iniciando agente WhatsApp…");

// Drena el outbox cada 5 segundos (mensajes del dashboard)
setInterval(() => {
  void drainOutbox();
}, 5_000);

startBaileyClient().catch((err) => {
  console.error("[bot] Error fatal:", err);
  process.exit(1);
});
