"use server";

import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/session";

const LoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

export type LoginState = { error?: string };

// Pre-computed hash so unknown emails take as long as wrong passwords.
const DUMMY_HASH = "$2b$12$Z7JdRUkuv9gBuDa/NO22Fux40QuxgJxrto2lSzwOhkoHMX5MBfkNe";

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const { email, password, next } = parsed.data;
  const [user] = await getDb()
    .select({
      id: schema.users.id,
      passwordHash: schema.users.passwordHash,
      active: schema.users.active,
      sessionVersion: schema.users.sessionVersion,
    })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`)
    .limit(1);

  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !user.passwordHash || !ok) {
    return { error: "Incorrect email or password." };
  }

  const session = await getSession();
  session.userId = user.id;
  session.v = user.sessionVersion;
  await session.save();

  await getDb()
    .update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await audit({ actorId: user.id, action: "login", entity: "user", entityId: user.id });

  // Only allow internal redirects.
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logout() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
