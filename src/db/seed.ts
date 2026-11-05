/**
 * Seeds DUMMY data only. Never load real BOEMI customer data into the
 * staging database — real data goes in after the move to BOEMI's Google Cloud.
 *
 *   npm run db:seed
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client, { schema, casing: "snake_case" });

  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error("Set SEED_ADMIN_PASSWORD (min. 10 characters) before seeding");
  }
  const passwordHash = await bcrypt.hash(password, 12);

  const [admin, manager, sales] = await db
    .insert(schema.users)
    .values([
      { name: "Admin Demo", email: "admin@example.test", role: "admin", passwordHash },
      { name: "Manager Demo", email: "manager@example.test", role: "sales_manager", passwordHash },
      { name: "Sales Demo", email: "sales@example.test", role: "sales", passwordHash },
    ])
    .onConflictDoNothing()
    .returning();

  if (!admin) {
    console.log("Seed users already exist — skipping.");
    await client.end();
    return;
  }

  await db
    .update(schema.users)
    .set({ managerId: manager.id })
    .where(eq(schema.users.id, sales.id));

  await db.insert(schema.products).values([
    { sku: "DEMO-SPRAY-01", name: "Demo Multipurpose Spray", category: "Spray", price: 150_000 },
    { sku: "DEMO-OIL-01", name: "Demo Body Oil", category: "Body Oil", price: 185_000 },
  ]);

  const customers = await db
    .insert(schema.customers)
    .values([
      {
        name: "Toko Contoh Satu",
        businessType: "Retail",
        status: "prospect",
        phoneE164: "+6281200000001",
        city: "Jakarta",
        ownerId: sales.id,
        source: "event",
        qualificationScore: 82,
        qualificationTier: "hot",
        qualificationReason: "Sample data: high volume potential, decision maker met",
      },
      {
        name: "Spa Contoh Dua",
        businessType: "Spa & Wellness",
        status: "lead",
        phoneE164: "+6281200000002",
        city: "Bandung",
        ownerId: sales.id,
        source: "journey",
        qualificationScore: 55,
        qualificationTier: "warm",
        qualificationReason: "Sample data: interested, budget unknown",
      },
    ])
    .returning();

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(schema.tasks).values({
    title: "Follow up sample order",
    customerId: customers[0].id,
    assigneeId: sales.id,
    createdBy: manager.id,
    dueAt: tomorrow,
  });

  await db.insert(schema.qualificationCriteria).values([
    { name: "Target business type", field: "businessType", operator: "in", value: ["Retail", "Spa & Wellness", "Hotel"], weight: 30 },
    { name: "Marketing consent given", field: "marketingConsent", operator: "equals", value: true, weight: 10 },
  ]);

  console.log("Seeded demo users (admin/manager/sales @example.test), products, customers, task.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
