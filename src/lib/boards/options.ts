import "server-only";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import { accountOptions } from "@/lib/queries/options";
import { ownedBy } from "@/lib/scope";
import { headedDepartments } from "./access";

/** Options for the board/project form, scoped to the user. */
export async function boardFormOptions(user: CurrentUser) {
  const db = getDb();
  const anyDept = user.role === "admin" || user.role === "executive";
  const own = anyDept ? [] : [...new Set([user.departmentId, ...(await headedDepartments(user))].filter((x): x is string => Boolean(x)))];
  const [departments, accounts, deals] = await Promise.all([
    anyDept || own.length
      ? db
          .select({ value: schema.departments.id, label: schema.departments.name })
          .from(schema.departments)
          .where(anyDept ? undefined : inArray(schema.departments.id, own))
          .orderBy(asc(schema.departments.name))
      : [],
    accountOptions(user),
    db
      .select({ value: schema.opportunities.id, label: sql<string>`${schema.opportunities.title} || ' · ' || coalesce(${schema.customers.name}, '')` })
      .from(schema.opportunities)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.opportunities.customerId))
      .where(and(ownedBy(user, schema.opportunities.ownerId), notInArray(schema.opportunities.stage, ["lost"])))
      .orderBy(asc(schema.opportunities.title)),
  ]);
  return { departments, accounts, deals, defaultDepartmentId: user.departmentId ?? undefined };
}
