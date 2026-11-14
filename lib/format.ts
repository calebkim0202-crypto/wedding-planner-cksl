/** Parse a money input like "1,250.50" into integer cents. */
export function toCents(v: FormDataEntryValue | null): number {
  const n = Math.round(parseFloat(String(v ?? "0").replace(/[^0-9.\-]/g, "")) * 100);
  return Number.isFinite(n) ? n : 0;
}

export function money(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

/** Dates are plain YYYY-MM-DD strings; format them without any timezone shifting. */
export function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Today's date (YYYY-MM-DD) in the given IANA timezone. */
export function todayIn(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(iso: string, tz: string) {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(todayIn(tz) + "T00:00:00Z")) / 86400000);
}

export function dueLabel(days: number) {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `in ${days} days`;
}

/** Throw if a Supabase call failed, otherwise return its data. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();
export const strOrNull = (v: FormDataEntryValue | null) => str(v) || null;

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
