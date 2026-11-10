/** CSV with spreadsheet formula-injection protection. */
function cell(v: unknown): string {
  if (v == null) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/* ───────────── Parsing (imports) ───────────── */

export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 5000;

export const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** Picks `,`, `;` or tab by counting them in the header line (outside quotes). */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts]++;
  }
  return counts[";"] > counts[","] && counts[";"] >= counts["\t"] ? ";" : counts["\t"] > counts[","] ? "\t" : ",";
}

/**
 * RFC 4180 parser: quoted fields may contain the delimiter, newlines and
 * doubled quotes (""). Handles CRLF / LF. Blank lines are dropped.
 * Spreadsheet-safe exports prefix risky cells with an apostrophe; that
 * apostrophe is removed again on import.
 */
export function parseCsv(input: string, delimiter = detectDelimiter(stripBom(input))): string[][] {
  const text = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const pushField = () => {
    row.push(/^'[=+\-@]/.test(field) ? field.slice(1) : field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) pushField();
    else if (ch === "\n") pushRow();
    else if (ch === "\r") {
      if (text[i + 1] !== "\n") pushRow();
    } else field += ch;
    i++;
  }
  if (field !== "" || row.length) pushRow();
  return rows;
}
