/**
 * src/lib/barberly.ts
 * Integración con la API real de Barberly (bs-api-platform.azurewebsites.net).
 * Endpoints descubiertos via ingeniería inversa del bundle de portal.barberly.com.
 */

const BASE_URL = "https://bs-api-platform.azurewebsites.net";
const CLIENT_ID = "58A69589-B7FF-42D8-BBF5-244C22A28336";
const LOCATION_ID = "1a9ee671-b0ae-4f45-a302-7cec110dde0b";

function apiFetch(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

// ─── Sesión ──────────────────────────────────────────────────────────────────

interface Session {
  token: string;
  expiresAt: number;
}

let session: Session | null = null;

async function getToken(): Promise<string> {
  if (session && Date.now() < session.expiresAt) return session.token;

  const res = await apiFetch(`${BASE_URL}/api/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "password",
      Username: process.env.BARBERLY_EMAIL,
      PasswordOrToken: process.env.BARBERLY_PASSWORD,
      ClientId: CLIENT_ID,
    }),
  });

  if (!res.ok) throw new Error(`Login Barberly falló (${res.status})`);

  const data = (await res.json()) as { access_token: string };
  if (!data.access_token) throw new Error("Barberly no devolvió access_token");

  session = { token: data.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return session.token;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ─── Catálogo ─────────────────────────────────────────────────────────────────

export interface BarbService {
  Id: string;
  Name: string;
  Duration: number;   // minutos
  Price: number;      // COP
}

export interface BarbEmployee {
  Id: string;
  FullName: string;
}

export interface BarbMember {
  Id: string;
  FirstName: string;
  LastName: string | null;
  FullName: string;
  PhoneNumber: string | null;
  Email: string | null;
}

// ─── Cache de miembros (5 min TTL) ───────────────────────────────────────────
let membersCache: { data: BarbMember[]; expiresAt: number } | null = null;

async function getAllMembers(): Promise<BarbMember[]> {
  if (membersCache && Date.now() < membersCache.expiresAt) return membersCache.data;
  const token = await getToken();
  const res = await apiFetch(`${BASE_URL}/api/members/search`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({}),
  }, 20_000); // 20s — la lista de clientes puede ser grande
  if (!res.ok) return [];
  const raw = await res.json() as BarbMember[] | { Items?: BarbMember[] };
  const data = Array.isArray(raw) ? raw : (raw.Items ?? []);
  membersCache = { data, expiresAt: Date.now() + 5 * 60 * 1000 };
  return data;
}

/** Normaliza a 10 dígitos colombianos (sin código de país). */
export function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  // +573001234567 o 573001234567 → 3001234567
  if (digits.length === 12 && digits.startsWith("57")) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith("057")) return digits.slice(3);
  return digits;
}

/** Genera variantes del teléfono para matching flexible entre formatos. */
function phoneVariants(phone: string): string[] {
  const norm = normalizePhone(phone);
  const raw = phone.replace(/\D/g, "");
  const set = new Set<string>([norm, raw, `57${norm}`, `+57${norm}`, `0057${norm}`]);
  if (raw.startsWith("57") && raw.length === 12) set.add(raw.slice(2));
  return Array.from(set).filter(Boolean);
}

/** Busca un cliente en Barberly por teléfono (matching flexible de formatos colombianos). */
export async function searchCustomerByPhone(phone: string): Promise<BarbMember | null> {
  console.log(`[customer-search] buscando: ${phone} (norm: ${normalizePhone(phone)})`);
  const members = await getAllMembers();
  const searchVariants = phoneVariants(phone);

  for (const member of members) {
    if (!member.PhoneNumber) continue;
    const memberVariants = phoneVariants(member.PhoneNumber);
    if (searchVariants.some((v) => memberVariants.includes(v))) {
      console.log(
        `[customer-match] phone=${phone} → id=${member.Id} name="${member.FullName}" stored_phone="${member.PhoneNumber}" source=phone`
      );
      return member;
    }
  }
  console.log(`[customer-search] no encontrado para: ${phone}`);
  return null;
}

/** @deprecated usa searchCustomerByPhone */
export async function findMemberByPhone(phone: string): Promise<BarbMember | null> {
  return searchCustomerByPhone(phone);
}

/** Crea un nuevo cliente en Barberly. */
export async function createMember(params: {
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
}): Promise<BarbMember> {
  const token = await getToken();
  const res = await apiFetch(`${BASE_URL}/api/members`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      FirstName: params.firstName,
      LastName: params.lastName ?? "",
      PhoneNumber: params.phone,
      Email: params.email ?? "",
    }),
  });
  if (!res.ok) throw new Error(`createMember falló (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as BarbMember;
  // Invalidar cache para que el nuevo miembro aparezca
  membersCache = null;
  return data;
}

/** Devuelve todos los servicios activos. */
export async function getServices(): Promise<BarbService[]> {
  const token = await getToken();
  const res = await apiFetch(`${BASE_URL}/api/services`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`getServices falló (${res.status})`);
  return res.json();
}

/** Devuelve todos los barberos activos. */
export async function getEmployees(): Promise<BarbEmployee[]> {
  const token = await getToken();
  const res = await apiFetch(`${BASE_URL}/api/employees`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`getEmployees falló (${res.status})`);
  return res.json();
}

// ─── Disponibilidad ───────────────────────────────────────────────────────────

export interface TimeSlotOption {
  date: string;   // "YYYY-MM-DD"
  time: string;   // "HH:MM" 24h
}

/**
 * Devuelve hasta `maxSlots` horarios disponibles para la fecha dada.
 * Si no hay slots en esa fecha, busca hacia adelante hasta 7 días.
 */
// Cuántos días hacia adelante buscar cuando la fecha pedida no tiene slots
const MAX_DAYS_FORWARD = 7;

export async function getAvailableSlots(
  serviceId: string,
  requestedDate: string,    // "YYYY-MM-DD"
  employeeId?: string,
): Promise<TimeSlotOption[]> {
  const token = await getToken();

  // Hora actual en Colombia (UTC-5, sin DST)
  const nowColombia = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
  const todayStr = nowColombia.toISOString().split("T")[0];
  const nowMinutes = nowColombia.getHours() * 60 + nowColombia.getMinutes();

  // Estrategia:
  // - Si employeeId está especificado: consultar AMBOS (con y sin employeeId) y unir.
  //   La API a veces sub-reporta slots del empleado-específico vs portal Barberly.
  // - Si NO hay employeeId: consultar cada empleado en paralelo y unir.
  //   El endpoint sin employeeId devuelve intersección (todos libres), no unión.
  type DayShape = { Date: string; Enabled: boolean; TimeSlots: Array<{ From: string }> };

  function extractTimesForDay(
    raw: unknown,
    d: string,
    empLabel: string,
  ): string[] {
    const times: string[] = [];
    if (!Array.isArray(raw)) return times;
    // Normalizar: la API puede devolver Array<Array<Day>>, Array<Day>, o incluso vacío.
    let weeks: DayShape[][];
    if (raw.length === 0) {
      weeks = [];
    } else if (Array.isArray(raw[0])) {
      weeks = raw as DayShape[][];
    } else {
      weeks = [raw as DayShape[]];
    }

    for (const week of weeks) {
      if (!Array.isArray(week)) continue;
      for (const day of week) {
        if (!day || typeof day !== "object" || !("Date" in day)) continue;
        if (typeof day.Date !== "string") continue;
        if (day.Date.startsWith(d) && day.Enabled && day.TimeSlots?.length) {
          for (const ts of day.TimeSlots) {
            if (!ts?.From || typeof ts.From !== "string") continue;
            const time24 = ts.From.split("T")[1]?.substring(0, 5);
            if (!time24) continue;
            if (d === todayStr) {
              const [h, m] = time24.split(":").map(Number);
              if (h * 60 + m < nowMinutes) continue;
            }
            times.push(time24);
          }
          console.log(`[slots-emp] ${d} emp=${empLabel} → ${times.length} slots: ${times.slice(0,5).join(", ")}${times.length > 5 ? "..." : ""}`);
          break;
        }
      }
    }
    return times;
  }

  for (let i = 0; i <= MAX_DAYS_FORWARD; i++) {
    const d = addDays(requestedDate, i);
    const [year, month] = d.split("-").map(Number);

    // Construir lista de queries a ejecutar.
    // - Si employeeId: query con empleado + query sin empleado (union).
    // - Si no: query por cada empleado (union de todos).
    type Query = { url: string; label: string };
    const queries: Query[] = [];

    if (employeeId) {
      // Solo query específica del empleado — incluir la query sin filtro causaba
      // que slots ocupados por ese barbero aparecieran disponibles (otros barberos
      // libres en ese horario contaminaban la unión).
      queries.push({
        url: `${BASE_URL}/api/bookings/location/${LOCATION_ID}/${year}/${month}/dates?serviceIds=${serviceId}&employeeId=${employeeId}`,
        label: `emp=${employeeId}`,
      });
    } else {
      const allEmps = await getEmployees();
      for (const e of allEmps) {
        queries.push({
          url: `${BASE_URL}/api/bookings/location/${LOCATION_ID}/${year}/${month}/dates?serviceIds=${serviceId}&employeeId=${e.Id}`,
          label: `emp=${e.Id}`,
        });
      }
    }

    const responses = await Promise.allSettled(
      queries.map(q =>
        apiFetch(q.url, { headers: authHeaders(token) })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    );

    const timeSet = new Set<string>();
    for (let j = 0; j < responses.length; j++) {
      const r = responses[j];
      const label = queries[j].label;
      if (r.status !== "fulfilled" || !r.value) {
        console.log(`[slots-query] ${d} ${label} → no response`);
        continue;
      }
      const times = extractTimesForDay(r.value, d, label);
      for (const t of times) timeSet.add(t);
    }

    if (timeSet.size > 0) {
      const times = [...timeSet].sort();
      console.log(`[slots] ${d} empId=${employeeId ?? "union"} → ${times.length} slots: ${times.join(", ")}`);
      return times.map(time => ({ date: d, time }));
    }
  }

  return [];
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ─── Agendar cita ─────────────────────────────────────────────────────────────

export interface AppointmentParams {
  date: string;         // "YYYY-MM-DD"
  time: string;         // "HH:MM" 24h
  serviceId: string;    // ID del servicio en Barberly
  serviceName: string;  // Para el mensaje de confirmación
  clientFirstName: string;
  clientLastName?: string;
  clientPhone: string;
  clientEmail?: string;
  employeeId?: string;  // Opcional; si no se pasa se asigna automáticamente
  customerId?: string;  // Si ya existe, se usa directamente sin buscar/crear
}

export interface AppointmentResult {
  success: boolean;
  appointmentId?: string;
  customerId?: string;  // barberly customer ID usado (existente o recién creado)
  message: string;
}

export async function scheduleAppointment(
  params: AppointmentParams
): Promise<AppointmentResult> {
  try {
    const token = await getToken();

    // Paso 1: resolver customer ID
    let memberId: string | undefined;
    let resolvedFirstName = params.clientFirstName;
    let resolvedLastName = params.clientLastName;
    let resolvedPhone = params.clientPhone;
    let resolvedEmail = params.clientEmail;

    if (params.customerId) {
      // Ya tenemos el ID — no buscar ni crear
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

    // Convertir "HH:MM" → minutos del día
    const [hh, mm] = params.time.split(":").map(Number);
    const startMinutes = hh * 60 + mm;

    // Obtener duración del servicio
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

    const res = await apiFetch(`${BASE_URL}/api/bookings`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, message: `Error al agendar (${res.status}): ${errText}` };
    }

    const data = (await res.json()) as { Id?: string };
    console.log(`[appointment-created] id=${data.Id} customer=${memberId} service=${params.serviceName} date=${params.date} time=${params.time}`);
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

// ─── Listar citas de un cliente ────────────────────────────────────────────────

export interface BarbBooking {
  Id: string;
  TimeSlot: { Date: string; StartMinutesOfDay: number; DurationMinutes: number };
  Services: string[];
  EmployeeId?: string;
  Status?: string;
}

export async function getCustomerBookings(customerId: string): Promise<BarbBooking[]> {
  const token = await getToken();
  // Intentar endpoint de búsqueda primero
  const res = await apiFetch(`${BASE_URL}/api/bookings/search`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ LocationId: LOCATION_ID, CustomerId: customerId }),
  });
  if (res.ok) {
    const data = await res.json() as BarbBooking[] | { Items?: BarbBooking[] };
    return Array.isArray(data) ? data : (data.Items ?? []);
  }
  // Fallback: GET con query params
  const res2 = await apiFetch(
    `${BASE_URL}/api/bookings?locationId=${LOCATION_ID}&customerId=${customerId}`,
    { headers: authHeaders(token) }
  );
  if (!res2.ok) return [];
  const data2 = await res2.json() as BarbBooking[] | { Items?: BarbBooking[] };
  return Array.isArray(data2) ? data2 : (data2.Items ?? []);
}

/** Obtiene una cita por su ID. Retorna null si no existe o fue cancelada. */
export async function getBookingById(bookingId: string): Promise<BarbBooking | null> {
  const token = await getToken();
  const res = await apiFetch(`${BASE_URL}/api/bookings/${bookingId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return null;
  try {
    return (await res.json()) as BarbBooking;
  } catch {
    return null;
  }
}

// ─── Cancelar cita ────────────────────────────────────────────────────────────

export async function cancelBooking(bookingId: string): Promise<{ success: boolean; message: string }> {
  const token = await getToken();
  // Intentar DELETE primero (REST estándar)
  const res = await apiFetch(`${BASE_URL}/api/bookings/${bookingId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (res.ok || res.status === 204) {
    console.log(`[appointment-cancelled] id=${bookingId}`);
    return { success: true, message: "Cita cancelada exitosamente." };
  }
  // Fallback: POST /cancel
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
