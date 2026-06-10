import { BASE_URL, LOCATION_ID, apiFetch, getToken, authHeaders } from "./http";
import { getServices } from "./catalog";
import { searchCustomerByPhone, createMember, invalidateMembersCache } from "./members";
import { getAvailableSlots } from "./availability";

export interface AppointmentParams {
  date: string;
  time: string;
  serviceId: string;
  serviceName: string;
  clientFirstName: string;
  clientLastName?: string;
  clientPhone: string;
  clientEmail?: string;
  employeeId?: string;
  customerId?: string;
}

export interface AppointmentResult {
  success: boolean;
  appointmentId?: string;
  customerId?: string;
  message: string;
}

export interface BarbBooking {
  Id: string;
  TimeSlot: { Date: string; StartMinutesOfDay: number; DurationMinutes: number };
  Services: string[];
  EmployeeId?: string;
  Status?: string;
}

export async function scheduleAppointment(params: AppointmentParams): Promise<AppointmentResult> {
  try {
    const token = await getToken();

    let memberId: string | undefined;
    let resolvedFirstName = params.clientFirstName;
    let resolvedLastName = params.clientLastName;
    let resolvedPhone = params.clientPhone;
    let resolvedEmail = params.clientEmail;

    if (params.customerId) {
      memberId = params.customerId;
      console.log(`[customer-reused] usando customerId pre-resuelto: ${memberId}`);
    } else {
      try {
        let member = await searchCustomerByPhone(params.clientPhone);
        if (!member) {
          member = await createMember({
            firstName: params.clientFirstName,
            lastName: params.clientLastName,
            phone: params.clientPhone,
            email: params.clientEmail,
          });
          console.log(`[customer-created] nuevo: ${member.Id} "${member.FullName}"`);
        } else {
          console.log(`[customer-reused] encontrado: ${member.Id} "${member.FullName}" email=${member.Email}`);
          resolvedFirstName = member.FirstName;
          resolvedLastName = member.LastName ?? resolvedLastName;
          resolvedPhone = member.PhoneNumber ?? resolvedPhone;
          resolvedEmail = member.Email ?? resolvedEmail;
        }
        memberId = member.Id;
      } catch (err) {
        console.warn(`[customer-search] error buscando/creando miembro:`, err);
      }
    }

    const [hh, mm] = params.time.split(":").map(Number);
    const startMinutes = hh * 60 + mm;

    const services = await getServices();
    const svc = services.find((s) => s.Id === params.serviceId);
    const duration = svc?.Duration ?? 60;

    const body = {
      Id: null,
      TimeSlot: {
        Date: `${params.date}T00:00:00`,
        StartMinutesOfDay: startMinutes,
        DurationMinutes: duration,
      },
      LocationId: LOCATION_ID,
      Services: [params.serviceId],
      EmployeeId: params.employeeId ?? null,
      EmployeeAssignedAutomatically: !params.employeeId,
      IgnoreConcurrentBookings: false,
      ...(memberId ? { CustomerId: memberId } : {}),
      CustomerInfo: {
        FirstName: resolvedFirstName,
        LastName: resolvedLastName ?? "",
        Phone: resolvedPhone,
        Email: resolvedEmail ?? "",
      },
    };

    // REVALIDACIÓN: verificar que el slot sigue disponible justo antes de crear
    const freshSlots = await getAvailableSlots(params.serviceId, params.date, params.employeeId);
    const slotStillAvailable = freshSlots.some(
      (s) => s.date === params.date && s.time === params.time,
    );
    if (!slotStillAvailable) {
      console.warn(`[appointment-revalidate] slot ${params.time} ${params.date} emp=${params.employeeId ?? "auto"} ya no disponible`);
      return {
        success: false,
        message: `El horario ${params.time} del ${params.date} ya no está disponible. Por favor elige otro horario.`,
      };
    }

    const res = await apiFetch(`${BASE_URL}/api/bookings`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, message: `Error al agendar (${res.status}): ${errText}` };
    }

    const data = (await res.json()) as { Id?: string; EmployeeId?: string };
    console.log(
      `[appointment-created] id=${data.Id} requestedEmp=${params.employeeId ?? "auto"} actualEmp=${data.EmployeeId ?? "unknown"} customer=${memberId} service=${params.serviceName} date=${params.date} time=${params.time}`,
    );

    if (params.employeeId && data.Id && data.EmployeeId && data.EmployeeId !== params.employeeId) {
      console.warn(`[appointment-mismatch] requested=${params.employeeId} actual=${data.EmployeeId} — cancelando ${data.Id}`);
      try { await cancelBooking(data.Id); } catch (e) { console.error("[appointment-mismatch] error cancelando:", e); }
      return { success: false, message: `El barbero solicitado no tiene disponibilidad en ese horario. Por favor elige otro horario.` };
    }

    invalidateMembersCache();

    return {
      success: true,
      appointmentId: data.Id,
      customerId: memberId,
      message: `✅ Cita confirmada en Barbería Ragnar\nServicio: ${params.serviceName}\nFecha: ${params.date}\nHora: ${params.time}\n\nTe esperamos. Ref: ${data.Id ?? "OK"}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Error interno al contactar Barberly: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function getCustomerBookings(customerId: string): Promise<BarbBooking[]> {
  const token = await getToken();
  const res = await apiFetch(`${BASE_URL}/api/bookings/search`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ LocationId: LOCATION_ID, CustomerId: customerId }),
  });
  if (res.ok) {
    const data = (await res.json()) as BarbBooking[] | { Items?: BarbBooking[] };
    return Array.isArray(data) ? data : (data.Items ?? []);
  }
  const res2 = await apiFetch(
    `${BASE_URL}/api/bookings?locationId=${LOCATION_ID}&customerId=${customerId}`,
    { headers: authHeaders(token) },
  );
  if (!res2.ok) return [];
  const data2 = (await res2.json()) as BarbBooking[] | { Items?: BarbBooking[] };
  return Array.isArray(data2) ? data2 : (data2.Items ?? []);
}

export async function getBookingById(bookingId: string): Promise<BarbBooking | null> {
  const token = await getToken();
  const res = await apiFetch(`${BASE_URL}/api/bookings/${bookingId}`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  try { return (await res.json()) as BarbBooking; } catch { return null; }
}

export async function cancelBooking(bookingId: string): Promise<{ success: boolean; message: string }> {
  const token = await getToken();
  const res = await apiFetch(`${BASE_URL}/api/bookings/${bookingId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (res.ok || res.status === 204) {
    console.log(`[appointment-cancelled] id=${bookingId}`);
    return { success: true, message: "Cita cancelada exitosamente." };
  }
  const res2 = await apiFetch(`${BASE_URL}/api/bookings/${bookingId}/cancel`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({}),
  });
  if (res2.ok) {
    console.log(`[appointment-cancelled] id=${bookingId} via /cancel`);
    return { success: true, message: "Cita cancelada exitosamente." };
  }
  console.warn(`[appointment-cancel-failed] id=${bookingId} status=${res.status}`);
  return {
    success: false,
    message: `No se pudo cancelar automáticamente (error ${res.status}). Por favor llama a la barbería para cancelar.`,
  };
}
