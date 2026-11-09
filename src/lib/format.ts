const TZ = "Asia/Jakarta";

/** Rp 1,250,000 */
export const rp = (n: number | null | undefined) =>
  n == null ? "—" : `Rp ${Math.round(n).toLocaleString("en-US")}`;

/** Rp 1.3M / Rp 2.05B — for tiles and charts. */
export const rpk = (n: number | null | undefined) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `Rp ${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `Rp ${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `Rp ${Math.round(n / 1e3)}K`;
  return rp(n);
};

export const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

export const pct = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}%`;

type DateLike = Date | string | null | undefined;
const toDate = (d: Exclude<DateLike, null | undefined>) =>
  d instanceof Date ? d : new Date(d.length === 10 ? `${d}T00:00:00+07:00` : d);

/** 9 Nov 2026 */
export const fdate = (d: DateLike) =>
  d ? toDate(d).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }) : "—";

/** 9 Nov */
export const fday = (d: DateLike) =>
  d ? toDate(d).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short" }) : "—";

/** 14:40 */
export const ftime = (d: DateLike) =>
  d ? toDate(d).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "—";

/** 9 Nov 2026, 14:40 */
export const fdatetime = (d: DateLike) => (d ? `${fdate(d)}, ${ftime(d)}` : "—");

/** YYYY-MM-DD in Jakarta time. */
export const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

/** YYYY-MM in Jakarta time. */
export const ym = (d: Date) => ymd(d).slice(0, 7);

/** "November 2026" from YYYY-MM */
export const monthLabel = (period: string, short = false) => {
  const d = new Date(`${period}-01T00:00:00Z`);
  return short
    ? d.toLocaleDateString("en-GB", { timeZone: "UTC", month: "short" }).slice(0, 3)
    : d.toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
};

/** Whole days from a to b (b − a), by Jakarta calendar date. */
export const daysBetween = (a: Date | string, b: Date | string) =>
  Math.round(
    (Date.parse(`${typeof b === "string" ? b : ymd(b)}T00:00:00Z`) -
      Date.parse(`${typeof a === "string" ? a : ymd(a)}T00:00:00Z`)) /
      86_400_000,
  );

export const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** +6281234567890 → +62 812-3456-7890 */
export const fphone = (e164: string | null | undefined) => {
  if (!e164) return "—";
  const m = e164.match(/^\+62(\d{3})(\d{3,4})(\d{3,4})$/);
  return m ? `+62 ${m[1]}-${m[2]}-${m[3]}` : e164;
};
