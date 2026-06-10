import { getServices, getEmployees } from "@/lib/barberly/catalog";
import { scheduleAppointment } from "@/lib/barberly/bookings";
import { normalizePhone } from "@/lib/barberly/members";
import {
  getCustomerMappingByWhatsApp,
  getCustomerMappingByPhone,
  upsertCustomerMapping,
  setLastAppointmentId,
} from "@/lib/db";
import { resolveEmployee } from "../employee-resolver";
import type { ToolContext } from "../types";

function parseHour24(raw: string): string {
  const m = raw
    .trim()
    .toLowerCase()
    .match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?m\.?|p\.?m\.?)?/i);
  if (!m) return raw;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] ?? "0");
  let periodRaw = (m[3] ?? "").toLowerCase().replace(/\./g, "");
  if (!periodRaw) {
    if (/(noche|tarde|pm)/.test(raw.toLowerCase())) periodRaw = "pm";
    else if (/(mañana|manana|am)/.test(raw.toLowerCase())) periodRaw = "am";
  }
  const period = periodRaw === "am" ? "am" : periodRaw === "pm" ? "pm" : "";
  if (period === "pm" && h !== 12) h += 12;
  else if (period === "am" && h === 12) h = 0;
  else if (!period && h > 0 && h <= 8) h += 12;
  if (h > 23) h = h % 24;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

export async function handleAgendarCita(
  args: Record<string, string>,
  ctx: ToolContext,
): Promise<string> {
  if (ctx.justShowedAllBarberList && (!args.barbero || args.barbero.trim() === "")) {
    ctx.agendarCitaCalled = true;
    return `ERROR CRÍTICO: Acabas de mostrar la lista de barberos disponibles. El cliente NO ha elegido ninguno todavía. Envía la lista al cliente ahora mismo y espera su respuesta. NO llames agendar_cita.`;
  }

  if (!args.barbero || args.barbero.trim() === "") {
    ctx.agendarCitaCalled = true;
    return `ERROR: No se puede agendar sin que el cliente haya elegido un barbero específico. Pregúntale al cliente con cuál barbero quiere la cita y espera su respuesta antes de llamar agendar_cita.`;
  }

  const telefono = args.telefono_cliente ?? ctx.clientPhone ?? "";
  if (!telefono.trim()) {
    ctx.agendarCitaCalled = true;
    return `ERROR: No se puede agendar sin el teléfono del cliente. Pídele su número con código de país (ej: +573001234567) antes de llamar agendar_cita.`;
  }

  if (args.hora) args.hora = parseHour24(args.hora);

  if (args.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(args.fecha)) {
    ctx.agendarCitaCalled = true;
    return `Formato de fecha inválido: "${args.fecha}". Necesito YYYY-MM-DD.`;
  }

  const svcs = await getServices();
  const svcMatch = svcs.find(
    (s) =>
      s.Name.toLowerCase().includes(args.service_name?.toLowerCase() ?? "") ||
      (args.service_name?.toLowerCase() ?? "").includes(s.Name.toLowerCase()),
  );
  if (!svcMatch) {
    ctx.agendarCitaCalled = true;
    return `Servicio "${args.service_name}" no encontrado. Servicios disponibles: ${svcs.map((s) => s.Name).join(", ")}. Pídele al cliente que confirme cuál quiere.`;
  }

  // Resolver customer desde DB local
  let knownCustomerId: string | undefined;
  let resolvedName = args.nombre_cliente ?? ctx.clientName ?? "Cliente";
  let resolvedEmail = args.email_cliente ?? "";
  let resolvedPhone = args.telefono_cliente ?? ctx.clientPhone ?? "";

  if (ctx.whatsappJid) {
    let mapping = getCustomerMappingByWhatsApp.get({ whatsapp_number: ctx.whatsappJid });
    if (!mapping && resolvedPhone) {
      const phoneKey = normalizePhone(resolvedPhone);
      if (phoneKey) {
        mapping = getCustomerMappingByPhone.get({ phone_normalized: phoneKey });
        if (mapping) console.log(`[customer-reused] agendar: encontrado por phone=${phoneKey} (JID ${ctx.whatsappJid} sin mapping)`);
      }
    }
    if (mapping) {
      knownCustomerId = mapping.barberly_customer_id;
      if (mapping.nombre) resolvedName = mapping.nombre;
      if (mapping.email) resolvedEmail = mapping.email;
      if (mapping.phone_normalized) resolvedPhone = mapping.phone_normalized;
      console.log(`[customer-reused] agendar: whatsapp=${ctx.whatsappJid} barberly_id=${knownCustomerId} nombre="${resolvedName}" source=local_db`);
    }
  }

  const emps = await getEmployees();
  const matchedEmp = resolveEmployee(args.barbero, emps);
  if (!matchedEmp) {
    ctx.agendarCitaCalled = true;
    return `Barbero "${args.barbero}" no encontrado en el sistema. Barberos disponibles: ${emps.map((e) => e.FullName).join(", ")}. No se puede agendar sin confirmar el barbero.`;
  }

  const appt = await scheduleAppointment({
    date: args.fecha,
    time: args.hora,
    serviceId: svcMatch.Id,
    serviceName: svcMatch.Name,
    clientFirstName: resolvedName,
    clientLastName: args.apellido_cliente,
    clientPhone: resolvedPhone,
    clientEmail: resolvedEmail || undefined,
    employeeId: matchedEmp.Id,
    customerId: knownCustomerId,
  });

  if (appt.success && ctx.whatsappJid && appt.customerId) {
    upsertCustomerMapping.run({
      whatsapp_number: ctx.whatsappJid,
      barberly_customer_id: appt.customerId,
      nombre: resolvedName,
      email: resolvedEmail,
      phone_normalized: normalizePhone(resolvedPhone),
    });
    if (appt.appointmentId) {
      setLastAppointmentId.run({ whatsapp_number: ctx.whatsappJid, last_appointment_id: appt.appointmentId });
    }
    console.log(`[customer-created] persistido: whatsapp=${ctx.whatsappJid} barberly_id=${appt.customerId} appt_id=${appt.appointmentId}`);
  }

  ctx.agendarCitaCalled = true;
  console.log(`[agendar_cita] success=${appt.success} empId=${matchedEmp.Id} hora=${args.hora} fecha=${args.fecha} msg="${appt.message.substring(0, 100)}"`);

  if (!appt.success) {
    return (
      `❌ NO se agendó la cita. Razón: ${appt.message}\n\n` +
      `LA CITA NO QUEDÓ REGISTRADA. Genera AHORA una respuesta de texto al cliente explicando que ese horario no está disponible y ofrécele los horarios que ya obtuviste anteriormente. NO llames más herramientas.`
    );
  }

  let result = appt.message;
  if (matchedEmp.FullName) result += `\nBarbero confirmado: ${matchedEmp.FullName}`;
  return result;
}
