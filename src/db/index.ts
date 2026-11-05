import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Standard Postgres driver (postgres.js) so the same code runs on
 * Neon (staging, pooled connection string) and Cloud SQL (production).
 */
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    prepare: false, // required behind PgBouncer-style poolers (Neon pooled URL)
  });
  return drizzle(client, { schema, casing: "snake_case" });
}

type DB = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as { __db?: DB };

/** Lazily created so builds don't need a database connection. */
export function getDb(): DB {
  if (!globalForDb.__db) globalForDb.__db = createDb();
  return globalForDb.__db;
}

export { schema };
