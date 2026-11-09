import "server-only";
import type { SQL } from "drizzle-orm";
import { schema } from "@/db";
import type { CurrentUser } from "./auth";
import { ownedBy } from "./scope";

/** Row-level scope: sales only see customers they own. */
export function customerScope(user: CurrentUser): SQL | undefined {
  return ownedBy(user, schema.customers.ownerId);
}
