import "server-only";
import { cacheLife } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSession } from "./session";

import type { Role } from "./roles";

export type { Role };

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarKey: string | null;
};

async function loadUser(): Promise<CurrentUser> {
  const { userId, v } = await getSession();
  if (!userId) redirect("/login");

  const [user] = await getDb()
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      sessionVersion: schema.users.sessionVersion,
      avatarKey: schema.users.avatarKey,
    })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.active, true)))
    .limit(1);

  // Signed out everywhere after a password change.
  if (!user || user.sessionVersion !== (v ?? 0)) redirect("/login");
  return { id: user.id, name: user.name, email: user.email, role: user.role, avatarKey: user.avatarKey };
}

/**
 * For rendering: reads the session cookie and returns a narrow user object.
 * Must be called inside a <Suspense> boundary (Cache Components).
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  "use cache: private";
  cacheLife("minutes");
  return loadUser();
}

/**
 * For Server Actions and Route Handlers: always re-checks the session and
 * the user's active flag against the database (never cached).
 */
export async function verifyUser(): Promise<CurrentUser> {
  return loadUser();
}

/** Throws (redirects) unless the current user has one of the given roles. */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user.role !== "admin" && !roles.includes(user.role)) {
    redirect("/dashboard?denied=1");
  }
  return user;
}
