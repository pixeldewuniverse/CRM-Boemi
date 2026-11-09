import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";
import { isManager } from "@/lib/permissions";

/** Accounts the user may attach records to. */
export async function accountOptions(user: CurrentUser) {
  const rows = await getDb()
    .select({ value: schema.customers.id, label: schema.customers.name })
    .from(schema.customers)
    .where(customerScope(user))
    .orderBy(asc(schema.customers.name));
  return rows;
}

/** Sales reps a manager can assign to (empty for everyone else). */
export async function repOptions(user: CurrentUser) {
  if (!isManager(user)) return [];
  return getDb()
    .select({ value: schema.users.id, label: schema.users.name })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), inArray(schema.users.role, ["sales", "sales_manager"])))
    .orderBy(asc(schema.users.name));
}

export async function campaignOptions() {
  return getDb()
    .select({ value: schema.campaigns.id, label: schema.campaigns.name })
    .from(schema.campaigns)
    .where(inArray(schema.campaigns.status, ["running", "scheduled"]))
    .orderBy(asc(schema.campaigns.name));
}
