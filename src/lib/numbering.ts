import "server-only";
import { sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { formatNumber, numberParts as parts } from "./doc-number";
import { getSetting } from "./settings";

export { formatNumber };

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0] | ReturnType<typeof getDb>;

/**
 * Next document number, e.g. Q-2611-013. The counter row is incremented
 * atomically (INSERT … ON CONFLICT DO UPDATE … RETURNING), so two users
 * saving at the same moment never get the same number.
 */
export async function nextDocumentNumber(db: Tx, docType: "quotation" | "order", now = new Date()): Promise<string> {
  const s = await getSetting(docType, db);
  const p = parts(now);
  const period = s.reset === "month" ? `${p.YYYY}${p.MM}` : s.reset === "year" ? p.YYYY : "all";
  const rows = await db.execute<{ last_seq: number }>(sql`
    INSERT INTO document_counters (doc_type, period, last_seq) VALUES (${docType}, ${period}, 1)
    ON CONFLICT (doc_type, period) DO UPDATE SET last_seq = document_counters.last_seq + 1
    RETURNING last_seq`);
  const seq = Number((rows as unknown as { last_seq: number }[])[0].last_seq);
  return formatNumber(s.format, s.prefix, seq, s.seqDigits, now);
}
