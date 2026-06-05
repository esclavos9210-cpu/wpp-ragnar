import { BASE_URL, LOCATION_ID, apiFetch, getToken, authHeaders } from "./http";
import { getEmployees } from "./catalog";

export interface TimeSlotOption {
  date: string;  // "YYYY-MM-DD"
  time: string;  // "HH:MM" 24h
}

const MAX_DAYS_FORWARD = 7;

function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export async function getAvailableSlots(
  serviceId: string,
  requestedDate: string,
  employeeId?: string,
): Promise<TimeSlotOption[]> {
  const token = await getToken();

  const partsArr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const parts: Record<string, string> = {};
  for (const p of partsArr) parts[p.type] = p.value;
  const todayStr = `${parts.year}-${parts.month}-${parts.day}`;
  const nowMinutes = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  console.log(`[slots] now Colombia: ${todayStr} ${parts.hour}:${parts.minute} (nowMinutes=${nowMinutes})`);

  type DayShape = { Date: string; Enabled: boolean; TimeSlots: Array<{ From: string }> };

  function extractTimesForDay(raw: unknown, d: string, empLabel: string): string[] {
    const times: string[] = [];
    if (!Array.isArray(raw)) return times;
    let weeks: DayShape[][];
    if (raw.length === 0) weeks = [];
    else if (Array.isArray(raw[0])) weeks = raw as DayShape[][];
    else weeks = [raw as DayShape[]];

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
          console.log(`[slots-emp] ${d} emp=${empLabel} → ${times.length} slots: ${times.slice(0, 5).join(", ")}${times.length > 5 ? "..." : ""}`);
          break;
        }
      }
    }
    return times;
  }

  for (let i = 0; i <= MAX_DAYS_FORWARD; i++) {
    const d = addDays(requestedDate, i);
    const [year, month] = d.split("-").map(Number);

    type Query = { url: string; label: string };
    const queries: Query[] = [];

    if (employeeId) {
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

    for (const q of queries) console.log(`[slots-fetch] ${d} URL=${q.url}`);

    const responses = await Promise.allSettled(
      queries.map((q) =>
        apiFetch(q.url, { headers: authHeaders(token) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
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
      const first = times[0];
      const last = times[times.length - 1];
      console.log(`[slots] ${d} empId=${employeeId ?? "union"} total=${times.length} first=${first} last=${last}`);
      console.log(`[slots] ${d} all: ${times.join(", ")}`);
      return times.map((time) => ({ date: d, time }));
    }
  }

  return [];
}
