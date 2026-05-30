/**
 * scripts/start-bot.ts
 * Punto de entrada del proceso bot.
 * CRÍTICO: env-loader DEBE ser el primer import.
 */
import "./env-loader"; // <- carga .env.local ANTES que todo

import { startBaileyClient } from "../src/lib/baileys/client";
import { drainOutbox } from "../src/lib/baileys/handler";
import { getRestartRequested, setRestartRequested } from "../src/lib/db";
import { startReminderScheduler } from "../src/lib/reminder-scheduler";

console.log("[bot] Iniciando agente WhatsApp…");

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

// Iniciar scheduler de recordatorios (solo activo si META_WA_TOKEN está configurado)
startReminderScheduler();

startBaileyClient().catch((err) => {
  console.error("[bot] Error fatal:", err);
  process.exit(1);
});
