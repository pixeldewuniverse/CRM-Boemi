/**
 * Creates (or resets) a Super Admin on an empty production database — no demo data.
 *
 *   ADMIN_EMAIL=it@boemibotanicals.com ADMIN_NAME="BOEMI IT" ADMIN_PASSWORD='…' npm run admin:create
 *
 * The password must be ≥ 12 characters; the user is asked to change it at first sign-in.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || "Super Admin";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("Set ADMIN_EMAIL");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");
  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client, { schema, casing: "snake_case" });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`);
    if (existing) {
      await db.update(schema.users).set({ role: "admin", active: true, passwordHash, mustChangePassword: true, sessionVersion: sql`${schema.users.sessionVersion} + 1` }).where(sql`${schema.users.id} = ${existing.id}`);
      console.log(`Updated ${email}: Super Admin, new temporary password.`);
    } else {
      await db.insert(schema.users).values({ email, name, role: "admin", passwordHash, mustChangePassword: true, active: true, position: "Super Admin" });
      console.log(`Created Super Admin ${email}.`);
    }
    await db.insert(schema.auditLogs).values({ actorId: null, action: existing ? "update" : "create", entity: "user", entityId: email, changes: { via: "scripts/create-admin.ts", role: "admin" } });
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
