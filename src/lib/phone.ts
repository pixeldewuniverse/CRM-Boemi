/**
 * Normalise Indonesian / international phone numbers to E.164 (+62…)
 * so the same customer is matched across forms, imports and visits.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;

  if (digits.startsWith("+")) {
    digits = "+" + digits.slice(1).replace(/\+/g, "");
  } else if (digits.startsWith("00")) {
    digits = "+" + digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = "+62" + digits.slice(1);
  } else if (digits.startsWith("62")) {
    digits = "+" + digits;
  } else if (digits.startsWith("8")) {
    digits = "+62" + digits;
  } else {
    digits = "+" + digits;
  }

  const length = digits.length - 1;
  return length >= 8 && length <= 15 ? digits : null;
}
