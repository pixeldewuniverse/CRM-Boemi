import "server-only";
import { eq, type AnyColumn, type SQL } from "drizzle-orm";
import { connection } from "next/server";
import type { CurrentUser } from "./auth";

/** Sales reps see only their own records; every other role sees all. */
export const seesAll = (user: CurrentUser) => user.role !== "sales";

export function ownedBy(user: CurrentUser, column: AnyColumn): SQL | undefined {
  return seesAll(user) ? undefined : eq(column, user.id);
}

/** Current time for request-time rendering (Cache Components). */
export async function now(): Promise<Date> {
  await connection();
  return new Date();
}
