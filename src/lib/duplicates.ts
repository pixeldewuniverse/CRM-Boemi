import "server-only";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * Same phone (normalised +62…) or email already in leads or accounts.
 * `exceptLeadId` / `exceptCustomerId` skip the record being edited (and, for
 * an account, the leads that were converted into it).
 */
export async function findDuplicate(phone: string | null, email: string | null, exceptLeadId?: string, exceptCustomerId?: string) {
  if (!phone && !email) return null;
  const db = getDb();
  const e = email?.toLowerCase() ?? null;
  const [acc] = await db
    .select({ name: schema.customers.name, owner: schema.users.name })
    .from(schema.customers)
    .leftJoin(schema.users, eq(schema.users.id, schema.customers.ownerId))
    .where(
      and(
        exceptCustomerId ? ne(schema.customers.id, exceptCustomerId) : undefined,
        or(phone ? eq(schema.customers.phoneE164, phone) : undefined, e ? sql`lower(${schema.customers.email}) = ${e}` : undefined),
      ),
    )
    .limit(1);
  if (acc) return `Already an account: ${acc.name}${acc.owner ? ` (owner ${acc.owner})` : ""}.`;
  const [lead] = await db
    .select({ company: schema.leads.company, owner: schema.users.name })
    .from(schema.leads)
    .leftJoin(schema.users, eq(schema.users.id, schema.leads.ownerId))
    .where(
      and(
        exceptLeadId ? ne(schema.leads.id, exceptLeadId) : undefined,
        exceptCustomerId ? or(isNull(schema.leads.customerId), ne(schema.leads.customerId, exceptCustomerId)) : undefined,
        or(phone ? eq(schema.leads.phoneE164, phone) : undefined, e ? sql`lower(${schema.leads.email}) = ${e}` : undefined),
      ),
    )
    .limit(1);
  if (lead) return `Already a lead: ${lead.company}${lead.owner ? ` (owner ${lead.owner})` : ""}.`;
  return null;
}

export type DuplicateMatch = { kind: "account" | "lead"; id: string; name: string; owner: string | null };

/**
 * Same rule as findDuplicate, for many rows at once (imports): looks up every
 * phone / email in accounts first, then leads. Keys are "phone:+62…" / "email:…".
 */
export async function findDuplicatesBulk(phones: string[], emails: string[]): Promise<Map<string, DuplicateMatch>> {
  const db = getDb();
  const out = new Map<string, DuplicateMatch>();
  const lower = [...new Set(emails.map((e) => e.toLowerCase()))];
  const uniqPhones = [...new Set(phones)];
  for (const [ph, em] of chunkPairs(uniqPhones, lower)) {
    if (!ph.length && !em.length) continue;
    const accounts = await db
      .select({ id: schema.customers.id, name: schema.customers.name, phone: schema.customers.phoneE164, email: schema.customers.email, owner: schema.users.name })
      .from(schema.customers)
      .leftJoin(schema.users, eq(schema.users.id, schema.customers.ownerId))
      .where(or(ph.length ? inArray(schema.customers.phoneE164, ph) : undefined, em.length ? inArray(sql`lower(${schema.customers.email})`, em) : undefined));
    for (const a of accounts) {
      const m: DuplicateMatch = { kind: "account", id: a.id, name: a.name, owner: a.owner };
      if (a.phone && !out.has(`phone:${a.phone}`)) out.set(`phone:${a.phone}`, m);
      if (a.email && !out.has(`email:${a.email.toLowerCase()}`)) out.set(`email:${a.email.toLowerCase()}`, m);
    }
    const leads = await db
      .select({ id: schema.leads.id, name: schema.leads.company, phone: schema.leads.phoneE164, email: schema.leads.email, owner: schema.users.name })
      .from(schema.leads)
      .leftJoin(schema.users, eq(schema.users.id, schema.leads.ownerId))
      .where(or(ph.length ? inArray(schema.leads.phoneE164, ph) : undefined, em.length ? inArray(sql`lower(${schema.leads.email})`, em) : undefined));
    for (const l of leads) {
      const m: DuplicateMatch = { kind: "lead", id: l.id, name: l.name, owner: l.owner };
      if (l.phone && !out.has(`phone:${l.phone}`)) out.set(`phone:${l.phone}`, m);
      if (l.email && !out.has(`email:${l.email.toLowerCase()}`)) out.set(`email:${l.email.toLowerCase()}`, m);
    }
  }
  return out;
}

/** Splits two lists into chunks of ≤ 1000 values per query. */
function chunkPairs(a: string[], b: string[], size = 1000): [string[], string[]][] {
  const n = Math.max(Math.ceil(a.length / size), Math.ceil(b.length / size), 1);
  return Array.from({ length: n }, (_, i) => [a.slice(i * size, (i + 1) * size), b.slice(i * size, (i + 1) * size)]);
}
