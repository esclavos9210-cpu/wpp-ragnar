import { BASE_URL, LOCATION_ID, apiFetch, getToken, authHeaders } from "./http";

export interface BarbService {
  Id: string;
  Name: string;
  Duration: number;
  Price: number;
}

export interface BarbEmployee {
  Id: string;
  FullName: string;
}

let locationSettingsCache: { data: unknown; expiresAt: number } | null = null;
const serviceSettingsCache = new Map<string, { data: unknown; expiresAt: number }>();

export async function getServices(): Promise<BarbService[]> {
  const token = await getToken();
  const res = await apiFetch(`${BASE_URL}/api/services`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`getServices falló (${res.status})`);
  return res.json();
}

export async function getEmployees(): Promise<BarbEmployee[]> {
  const token = await getToken();
  const res = await apiFetch(`${BASE_URL}/api/employees`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`getEmployees falló (${res.status})`);
  return res.json();
}

export async function getLocationSettings(): Promise<unknown | null> {
  if (locationSettingsCache && Date.now() < locationSettingsCache.expiresAt) {
    return locationSettingsCache.data;
  }
  const token = await getToken();
  const candidates = [
    `${BASE_URL}/api/locations/${LOCATION_ID}`,
    `${BASE_URL}/api/location/${LOCATION_ID}`,
    `${BASE_URL}/api/locations`,
  ];
  for (const url of candidates) {
    try {
      const res = await apiFetch(url, { headers: authHeaders(token) });
      if (!res.ok) { console.log(`[probe-location] ${url} → ${res.status}`); continue; }
      const data = await res.json();
      console.log(`[probe-location] ${url} → OK, keys: ${Object.keys(data ?? {}).join(", ").slice(0, 200)}`);
      locationSettingsCache = { data, expiresAt: Date.now() + 30 * 60 * 1000 };
      return data;
    } catch (e) {
      console.log(`[probe-location] ${url} → error: ${e instanceof Error ? e.message : e}`);
    }
  }
  return null;
}

export async function getServiceDetails(serviceId: string): Promise<unknown | null> {
  const cached = serviceSettingsCache.get(serviceId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  const token = await getToken();
  const candidates = [
    `${BASE_URL}/api/services/${serviceId}`,
    `${BASE_URL}/api/service/${serviceId}`,
  ];
  for (const url of candidates) {
    try {
      const res = await apiFetch(url, { headers: authHeaders(token) });
      if (!res.ok) { console.log(`[probe-service] ${url} → ${res.status}`); continue; }
      const data = await res.json();
      console.log(`[probe-service] ${url} → OK, keys: ${Object.keys(data ?? {}).join(", ").slice(0, 200)}`);
      serviceSettingsCache.set(serviceId, { data, expiresAt: Date.now() + 30 * 60 * 1000 });
      return data;
    } catch (e) {
      console.log(`[probe-service] ${url} → error: ${e instanceof Error ? e.message : e}`);
    }
  }
  return null;
}
