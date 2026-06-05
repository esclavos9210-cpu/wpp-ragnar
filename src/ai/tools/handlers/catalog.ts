import { getServices, getEmployees } from "@/lib/barberly/catalog";
import type { ToolContext } from "../types";

export async function handleConsultarServicios(
  _args: Record<string, string>,
  _ctx: ToolContext,
): Promise<string> {
  const svcs = await getServices();
  return svcs
    .map((s) => `• ${s.Name} — $${s.Price.toLocaleString("es-CO")} COP (${s.Duration} min)`)
    .join("\n");
}

export async function handleConsultarBarberos(
  _args: Record<string, string>,
  _ctx: ToolContext,
): Promise<string> {
  const emps = await getEmployees();
  if (emps.length === 0) return "No se encontraron barberos activos en este momento.";
  return (
    `Barberos activos en Barbería Ragnar (${emps.length} en total):\n` +
    emps.map((e) => `• ${e.FullName}`).join("\n") +
    "\n\nSolo estos barberos trabajan actualmente. Si el cliente pregunta por uno que no aparece aquí, no trabaja con nosotros."
  );
}
