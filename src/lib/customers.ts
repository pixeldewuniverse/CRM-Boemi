import "server-only";
import { eq, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import { SEES_ALL_CUSTOMERS, type CurrentUser } from "./auth";

/** Row-level scope: sales only see customers they own. */
export function customerScope(user: CurrentUser): SQL | undefined {
  return SEES_ALL_CUSTOMERS.includes(user.role)
    ? undefined
    : eq(schema.customers.ownerId, user.id);
}
