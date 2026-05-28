/**
 * scripts/env-loader.ts
 * CRÍTICO: debe ser el PRIMER import de start-bot.ts.
 * Carga .env.local en process.env antes de que cualquier otro módulo
 * lea las variables de entorno.
 *
 * Next.js carga .env.local automáticamente, pero el proceso bot
 * (tsx scripts/start-bot.ts) corre fuera de Next.js, así que necesita
 * cargarlas manualmente.
 */
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");

if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  console.log("[env-loader] .env.local cargado correctamente");
} else {
  console.warn("[env-loader] .env.local no encontrado — usando variables de entorno del sistema");
}
