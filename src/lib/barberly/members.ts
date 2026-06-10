import { BASE_URL, apiFetch, getToken, authHeaders } from "./http";

export interface BarbMember {
  Id: string;
  FirstName: string;
  LastName: string | null;
  FullName: string;
  PhoneNumber: string | null;
  Email: string | null;
}

let membersCache: { data: BarbMember[]; expiresAt: number } | null = null;

async function getAllMembers(): Promise<BarbMember[]> {
  if (membersCache && Date.now() < membersCache.expiresAt) return membersCache.data;
  const token = await getToken();
  const res = await apiFetch(
    `${BASE_URL}/api/members/search`,
    { method: "POST", headers: authHeaders(token), body: JSON.stringify({}) },
    20_000,
  );
  if (!res.ok) return [];
  const raw = (await res.json()) as BarbMember[] | { Items?: BarbMember[] };
  const data = Array.isArray(raw) ? raw : (raw.Items ?? []);
  membersCache = { data, expiresAt: Date.now() + 2 * 60 * 1000 };
  return data;
}

export function invalidateMembersCache(): void {
  membersCache = null;
}

export function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("57")) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith("057")) return digits.slice(3);
  return digits;
}

function phoneVariants(phone: string): string[] {
  const norm = normalizePhone(phone);
  const raw = phone.replace(/\D/g, "");
  const set = new Set<string>([norm, raw, `57${norm}`, `+57${norm}`, `0057${norm}`]);
  if (raw.startsWith("57") && raw.length === 12) set.add(raw.slice(2));
  return Array.from(set).filter(Boolean);
}

export async function searchCustomerByPhone(phone: string): Promise<BarbMember | null> {
  console.log(`[customer-search] buscando: ${phone} (norm: ${normalizePhone(phone)})`);
  const members = await getAllMembers();
  const searchVariants = phoneVariants(phone);
  for (const member of members) {
    if (!member.PhoneNumber) continue;
    const memberVariants = phoneVariants(member.PhoneNumber);
    if (searchVariants.some((v) => memberVariants.includes(v))) {
      console.log(
        `[customer-match] phone=${phone} → id=${member.Id} name="${member.FullName}" stored_phone="${member.PhoneNumber}" source=phone`,
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
  membersCache = null;
  return data;
}
