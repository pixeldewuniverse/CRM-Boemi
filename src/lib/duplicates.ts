import "server-only";
import { eq, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Same phone (normalised +62…) or email already in leads or accounts. */
export async function findDuplicate(phone: string | null, email: string | null, exceptLeadId?: string) {
  if (!phone && !email) return null;
  const db = getDb();
  const e = email?.toLowerCase() ?? null;
  const [acc] = await db
    .select({ name: schema.customers.name, owner: schema.users.name })
    .from(schema.customers)
    .leftJoin(schema.users, eq(schema.users.id, schema.customers.ownerId))
    .where(
      or(
        phone ? eq(schema.customers.phoneE164, phone) : undefined,
        e ? sql`lower(${schema.customers.email}) = ${e}` : undefined,
      ),
    )
    .limit(1);
  if (acc) return `Already an account: ${acc.name}${acc.owner ? ` (owner ${acc.owner})` : ""}.`;
  const [lead] = await db
    .select({ id: schema.leads.id, company: schema.leads.company, owner: schema.users.name })
    .from(schema.leads)
    .leftJoin(schema.users, eq(schema.users.id, schema.leads.ownerId))
    .where(
      or(phone ? eq(schema.leads.phoneE164, phone) : undefined, e ? sql`lower(${schema.leads.email}) = ${e}` : undefined),
    )
    .limit(1);
  if (lead && lead.id !== exceptLeadId) return `Already a lead: ${lead.company}${lead.owner ? ` (owner ${lead.owner})` : ""}.`;
  return null;
}
