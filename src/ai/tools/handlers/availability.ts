import { getServices, getLocationSettings, getServiceDetails, getEmployees } from "@/lib/barberly/catalog";
import { getAvailableSlots } from "@/lib/barberly/availability";
import { resolveEmployee } from "../employee-resolver";
import type { ToolContext } from "../types";

function to12h(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

export async function handleConsultarDisponibilidad(
  args: Record<string, string>,
  ctx: ToolContext,
): Promise<string> {
  const svcs = await getServices();
  const svcMatch = svcs.find(
    (s) =>
      s.Name.toLowerCase().includes(args.service_name?.toLowerCase() ?? "") ||
      (args.service_name?.toLowerCase() ?? "").includes(s.Name.toLowerCase()),
  );
  if (!svcMatch) {
    return `Servicio "${args.service_name}" no encontrado. Servicios disponibles: ${svcs.map((s) => s.Name).join(", ")}`;
  }

  // Probes en background — solo loggea, no afecta el flujo del cliente
  void getLocationSettings().catch(() => null);
  void getServiceDetails(svcMatch.Id).catch(() => null);

  let empId: string | undefined;
  let matchedEmpName: string | undefined;
  if (args.barbero) {
    const emps = await getEmployees();
    const matchedEmp = resolveEmployee(args.barbero, emps);
    if (!matchedEmp) {
      return `Barbero "${args.barbero}" no encontrado en el equipo. Barberos activos: ${emps.map((e) => e.FullName).join(", ")}. Pídele al cliente que confirme el nombre.`;
    }
    empId = matchedEmp.Id;
    matchedEmpName = matchedEmp.FullName;
  }

  // Caso especial: cliente pregunta "¿quién tiene disponibilidad a las X?"
  if (args.hora_solicitada && !empId) {
    const allEmps = await getEmployees();
    const perEmp = await Promise.allSettled(
      allEmps.map((emp) =>
        getAvailableSlots(svcMatch.Id, args.fecha, emp.Id)
          .then((s) => ({ name: emp.FullName, has: s.some((x) => x.date === args.fecha && x.time === args.hora_solicitada) }))
          .catch(() => ({ name: emp.FullName, has: false })),
      ),
    );
    const availableEmps = perEmp
      .filter((r): r is PromiseFulfilledResult<{ name: string; has: boolean }> => r.status === "fulfilled" && r.value.has)
      .map((r) => r.value.name);
    const timeStr = to12h(args.hora_solicitada);
    if (availableEmps.length === 0) {
      return `No hay ningún barbero disponible a las ${timeStr} para "${svcMatch.Name}" el ${args.fecha}.`;
    }
    ctx.justShowedAllBarberList = true;
    return (
      `Barberos disponibles a las ${timeStr} para "${svcMatch.Name}" el ${args.fecha}:\n` +
      availableEmps.map((n) => `• ${n}`).join("\n") +
      `\n\nMuestra esta lista al cliente y espera que elija un barbero. NO llames agendar_cita hasta que el cliente elija explícitamente.`
    );
  }

  const slots = await getAvailableSlots(svcMatch.Id, args.fecha, empId);
  if (slots.length === 0) {
    return `No hay disponibilidad para "${svcMatch.Name}" el ${args.fecha}. Prueba otra fecha.`;
  }

  const byDate = new Map<string, string[]>();
  for (const s of slots) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s.time);
  }

  const lines: string[] = [];
  const allSlotsList: string[] = [];

  for (const [date, times] of byDate) {
    const sorted = [...times].sort();
    sorted.forEach((t) => allSlotsList.push(t));

    // Slots individuales — NO rangos.
    // Los rangos confunden al LLM: interpreta que cualquier hora dentro
    // del rango está disponible cuando solo existen los slots exactos.
    const slotsStr = sorted.map((t) => to12h(t)).join(" | ");
    lines.push(`• ${date}: ${slotsStr}`);
  }

  let extraNote = "";
  if (args.hora_solicitada) {
    const reqInSlots = allSlotsList.includes(args.hora_solicitada);
    if (reqInSlots) {
      extraNote = `\n\n✅ ${to12h(args.hora_solicitada)} SÍ está disponible. Procede a agendar_cita directamente.`;
    } else {
      extraNote = `\n\n❌ ${to12h(args.hora_solicitada)} NO está disponible. Informa al cliente que no hay disponibilidad a esa hora y ofrécele los horarios reales listados arriba.`;
    }
  }

  const barberLabel = matchedEmpName ? ` (${matchedEmpName})` : "";
  const totalSlots = allSlotsList.length;
  const instruction = `\n\nINSTRUCCIÓN: estos son los únicos horarios disponibles. Si el cliente pide una hora que NO aparece aquí, dile que no hay disponibilidad a esa hora y ofrece los horarios reales. Al agendar usa formato 24h (8pm → 20:00, 4pm → 16:00).`;

  return `Horarios disponibles para "${svcMatch.Name}"${barberLabel} (${totalSlots} slots):\n${lines.join("\n")}${instruction}${extraNote}`;
}
