import { getCustomerBookings, getBookingById, cancelBooking } from "@/lib/barberly/bookings";
import { searchCustomerByPhone, normalizePhone } from "@/lib/barberly/members";
import { getCustomerMappingByWhatsApp, getCustomerMappingByPhone } from "@/lib/db";
import type { ToolContext } from "../types";

export async function handleListarCitas(
  args: Record<string, string>,
  ctx: ToolContext,
): Promise<string> {
  const phone = args.telefono ?? "";
  let mapping = ctx.whatsappJid
    ? getCustomerMappingByWhatsApp.get({ whatsapp_number: ctx.whatsappJid })
    : null;
  if (!mapping && phone) {
    const phoneKey = normalizePhone(phone);
    if (phoneKey) {
      mapping = getCustomerMappingByPhone.get({ phone_normalized: phoneKey }) ?? null;
      if (mapping) console.log(`[listar_citas] mapping encontrado por phone=${phoneKey}`);
    }
  }

  const todayColombiaStr = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }),
  )
    .toISOString()
    .split("T")[0];

  const isCancelled = (b: { Status?: string }) =>
    b.Status != null && /cancel|anulad|void/i.test(b.Status);

  function formatBookings(bookings: Awaited<ReturnType<typeof getCustomerBookings>>) {
    const upcoming = bookings.filter(
      (b) => b.TimeSlot.Date.split("T")[0] >= todayColombiaStr && !isCancelled(b),
    );
    if (upcoming.length === 0) return null;
    return (
      `Citas próximas del cliente:\n` +
      upcoming
        .map((b) => {
          const h = Math.floor(b.TimeSlot.StartMinutesOfDay / 60).toString().padStart(2, "0");
          const m = (b.TimeSlot.StartMinutesOfDay % 60).toString().padStart(2, "0");
          return `• ID: ${b.Id} | Fecha: ${b.TimeSlot.Date.split("T")[0]} | Hora: ${h}:${m}`;
        })
        .join("\n")
    );
  }

  let result = "";

  // 1. Lookup directo por last_appointment_id
  if (mapping?.last_appointment_id) {
    console.log(`[listar_citas] intentando last_appointment_id=${mapping.last_appointment_id}`);
    const booking = await getBookingById(mapping.last_appointment_id);
    if (booking && !isCancelled(booking)) {
      const bookingDateStr = booking.TimeSlot.Date.split("T")[0];
      if (bookingDateStr >= todayColombiaStr) {
        const h = Math.floor(booking.TimeSlot.StartMinutesOfDay / 60).toString().padStart(2, "0");
        const m = (booking.TimeSlot.StartMinutesOfDay % 60).toString().padStart(2, "0");
        result = `Cita próxima del cliente:\n• ID: ${booking.Id} | Fecha: ${bookingDateStr} | Hora: ${h}:${m}`;
      }
    }
  }

  // 2. Todas las citas por customerId del mapping
  if (!result && mapping?.barberly_customer_id) {
    console.log(`[listar_citas] intentando getCustomerBookings customerId=${mapping.barberly_customer_id}`);
    const bookings = await getCustomerBookings(mapping.barberly_customer_id);
    result = formatBookings(bookings) ?? "";
  }

  // 3. Buscar por teléfono en Barberly
  if (!result && phone) {
    const member = await searchCustomerByPhone(phone);
    if (member) {
      console.log(`[listar_citas] encontrado por teléfono: ${member.Id}`);
      const bookings = await getCustomerBookings(member.Id);
      result = formatBookings(bookings) ?? "";
    }
  }

  if (!result) {
    return phone
      ? `No encontré citas activas para este cliente. Si el número ${phone} es correcto, puede que no tenga citas registradas en Barberly.`
      : `No tengo el teléfono del cliente. Pídele su número de cel (con código de país, ej: +573001234567) para buscar sus citas.`;
  }
  return result;
}

export async function handleCancelarCita(
  args: Record<string, string>,
  ctx: ToolContext,
): Promise<string> {
  const citaId = args.cita_id ?? "";
  if (!citaId) {
    return `Necesitas el ID de la cita para cancelar. Llama primero a listar_citas.`;
  }
  const cancelResult = await cancelBooking(citaId);
  ctx.cancelarCitaCalled = true;
  return cancelResult.message;
}
