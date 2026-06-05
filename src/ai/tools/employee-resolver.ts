import type { BarbEmployee } from "@/lib/barberly/catalog";

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Fuzzy-resolves a barbero name against the employee list.
 * Tries exact include match first, then 5-char prefix match for typos.
 */
export function resolveEmployee(barberoName: string, employees: BarbEmployee[]): BarbEmployee | null {
  const normSearch = norm(barberoName);
  let match = employees.find((e) => norm(e.FullName).includes(normSearch));
  if (!match && normSearch.length >= 5) {
    const prefix = normSearch.slice(0, 5);
    match = employees.find((e) => {
      const firstName = norm(e.FullName).split(/\s+/)[0];
      return firstName.startsWith(prefix) || normSearch.startsWith(firstName.slice(0, 5));
    });
  }
  return match ?? null;
}
