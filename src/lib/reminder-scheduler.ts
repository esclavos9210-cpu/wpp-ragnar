/**
 * src/lib/reminder-scheduler.ts
 * Revisa las citas de Barberly cada minuto y envía recordatorios
 * 30 minutos antes via Meta WhatsApp Business API.
 *
 * Requiere en .env:
 *   META_WA_TOKEN            — token de acceso permanente de Meta
 *   META_WA_PHONE_NUMBER_ID  — ID del número en Meta
 *   META_WA_REMINDER_TEMPLATE — nombre del template aprobado (default: appointment_reminder)
 */

import { getEmployees, getServices } from "./barberly";
import { sendAppointmentReminder, isMetaConfigured } from "./meta-whatsapp";
import { wasReminderSent, markReminderSent } from "./db";

const BASE_URL = "https://bs-api-platform.azurewebsites.net";
const LOCATION_ID = "1a9ee671-b0ae-4f45-a302-7cec110dde0b";

// Ventana de envío: entre 25 y 35 minutos antes (corre cada minuto)
const WINDOW_MIN = 25;
const WINDOW_MAX = 35;

function to12h(minutesOfDay: number): string {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

/** Obtiene el token de Barberly (usa el mismo módulo pero accediendo a la función interna). */
async function getBarberlyToken(): Promise<string> {
  // Re-usa la lógica de login de barberly.ts llamando al endpoint directamente
  const res = await fetch(`${BASE_URL}/api/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "password",
      Username: process.env.BARBERLY_EMAIL,
      PasswordOrToken: process.env.BARBERLY_PASSWORD,
      ClientId: "58A69589-B7FF-42D8-BBF5-244C22A28336",
    }),
  });
  if (!res.ok) throw new Error(`Barberly login falló (${res.status})`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

interface Booking {
  Id: string;
  TimeSlot: { Date: string; StartMinutesOfDay: number };
  EmployeeId?: string;
  CustomerId?: string;
  CustomerInfo?: { FirstName?: string; LastName?: string; Phone?: string };
  Status?: string;
}

async function getUpcomingBookings(token: string): Promise<Booking[]> {
  // Obtener citas del día actual en Barberly
  const nowCO = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
  const dateStr = nowCO.toISOString().split("T")[0];

  const res = await fetch(
    `${BASE_URL}/api/bookings?locationId=${LOCATION_ID}&date=${dateStr}`,
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );
  if (!res.ok) return [];
  const data = await res.json() as Booking[] | { Items?: Booking[] };
  return Array.isArray(data) ? data : (data.Items ?? []);
}

async function checkAndSendReminders(): Promise<void> {
  if (!isMetaConfigured()) return;

  const nowCO = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
  const nowMinutes = nowCO.getHours() * 60 + nowCO.getMinutes();

  let token: string;
  try {
    token = await getBarberlyToken();
  } catch (err) {
    console.error("[reminder] No se pudo obtener token de Barberly:", err);
    return;
  }

  let bookings: Booking[];
  try {
    bookings = await getUpcomingBookings(token);
  } catch (err) {
    console.error("[reminder] Error obteniendo citas:", err);
    return;
  }

  // Obtener barberos para resolver nombre
  let employees: { Id: string; FullName: string }[] = [];
  try { employees = await getEmployees(); } catch {}

  for (const booking of bookings) {
    try {
      // Saltar canceladas/anuladas
      if (booking.Status && /cancel|anulad|void/i.test(booking.Status)) continue;

      const startMin = booking.TimeSlot.StartMinutesOfDay;
      const minutesUntil = startMin - nowMinutes;

      // Solo enviar si la cita es en 25-35 minutos
      if (minutesUntil < WINDOW_MIN || minutesUntil > WINDOW_MAX) continue;

      // Verificar si ya enviamos el recordatorio para esta cita
      if (wasReminderSent.get({ booking_id: booking.Id })) continue;

      const clientName = booking.CustomerInfo?.FirstName ?? "Cliente";
      const phone = booking.CustomerInfo?.Phone;
      if (!phone) {
        console.log(`[reminder] Cita ${booking.Id} sin teléfono — omitida`);
        continue;
      }

      const barber = employees.find(e => e.Id === booking.EmployeeId);
      const barberName = barber?.FullName ?? "nuestro equipo";
      const time12h = to12h(startMin);

      await sendAppointmentReminder({ phone, clientName, time12h, barberName });
      markReminderSent.run({ booking_id: booking.Id });
      console.log(`[reminder] ✓ Recordatorio enviado: ${clientName} ${time12h} con ${barberName}`);

    } catch (err) {
      console.error(`[reminder] Error procesando cita ${booking.Id}:`, err);
    }
  }
}

/** Inicia el scheduler — llama a esta función desde start-bot.ts */
export function startReminderScheduler(): void {
  if (!isMetaConfigured()) {
    console.log("[reminder] META_WA_TOKEN o META_WA_PHONE_NUMBER_ID no configurados — scheduler desactivado");
    return;
  }

  console.log("[reminder] Scheduler de recordatorios iniciado (cada 60s)");

  // Primera ejecución inmediata
  void checkAndSendReminders();

  // Luego cada minuto
  setInterval(() => { void checkAndSendReminders(); }, 60_000);
}
