/** Document number formatting (shared by server and the settings preview). */
/** Jakarta-time parts used by number formats. */
export function numberParts(now = new Date()) {
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  return { YYYY: ymd.slice(0, 4), YY: ymd.slice(2, 4), MM: ymd.slice(5, 7) };
}

export function formatNumber(format: string, prefix: string, seq: number, digits: number, now = new Date()) {
  const p = numberParts(now);
  return format
    .replaceAll("{PREFIX}", prefix)
    .replaceAll("{YYYY}", p.YYYY)
    .replaceAll("{YY}", p.YY)
    .replaceAll("{MM}", p.MM)
    .replaceAll("{SEQ}", String(seq).padStart(digits, "0"));
}

