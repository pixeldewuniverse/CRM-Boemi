import "server-only";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
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
