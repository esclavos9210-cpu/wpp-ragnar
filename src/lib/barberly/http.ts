const BASE_URL = "https://bs-api-platform.azurewebsites.net";
const CLIENT_ID = "58A69589-B7FF-42D8-BBF5-244C22A28336";
export const LOCATION_ID = "1a9ee671-b0ae-4f45-a302-7cec110dde0b";

export { BASE_URL };

export function apiFetch(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

interface Session {
  token: string;
  expiresAt: number;
}

let session: Session | null = null;

export async function getToken(): Promise<string> {
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

export function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
