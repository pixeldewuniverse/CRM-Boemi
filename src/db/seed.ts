/**
 * Seeds DUMMY demo data only (taken from the Phase 1 demo, demo.pixeldew.xyz).
 * Never load real BOEMI customer data into the staging database — real data
 * goes in after the move to BOEMI's Google Cloud.
 *
 *   npm run db:seed
 *
 * On Vercel it also runs during every build (`vercel-build`) with --optional:
 *  - first run needs SEED_ADMIN_PASSWORD (min. 10 chars) to create the logins;
 *    later runs reuse the existing demo password, so the variable can be removed;
 *  - demo data is inserted once (skipped when it already exists);
 *  - rows from the old minimal seed are replaced.
 *
 * Dates are shifted so the demo's "today" (2026-11-01) lands on the day the
 * seed runs — overdue tasks, pending fees, etc. stay realistic.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { normalizePhone } from "../lib/phone";
import { lineTotals, tierForSegment, unitPrice } from "../lib/pricing";
import demo from "./demo/demo-data.json";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Item = [string, number];

const DEMO_TODAY = Date.UTC(2026, 10, 1);
const MARKER_SKU = "BW-SEN-250";

/* ── date helpers (shifted to "today" in Asia/Jakarta) ── */
const jakartaToday = () => {
  const s = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  return Date.parse(`${s}T00:00:00Z`);
};
const OFFSET = jakartaToday() - DEMO_TODAY;
const shift = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + OFFSET);
const D = (ymd: string) => shift(ymd).toISOString().slice(0, 10);
/** Local Jakarta wall-clock time → Date. */
const T = (ymd: string, hhmm = "09:00") =>
  new Date(Date.parse(`${D(ymd)}T${hhmm}:00+07:00`));

/* ── deterministic pseudo-random for history ── */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/* ── demo personas → login accounts ── */
const PERSONAS: Record<string, { email: string; position: string; department: string; joinedOn: string; region: string }> = {
  u1: { email: "manager@example.test", position: "Sales Manager", department: "Sales", joinedOn: "2023-02-01", region: "All regions" },
  u2: { email: "sales@example.test", position: "Sales Executive", department: "Sales", joinedOn: "2023-06-12", region: "Bali" },
  u3: { email: "dewi@example.test", position: "Sales Executive", department: "Sales", joinedOn: "2024-01-08", region: "Jabodetabek" },
  u4: { email: "putu@example.test", position: "Sales Executive", department: "Sales", joinedOn: "2025-03-17", region: "Lombok & NTB" },
  u5: { email: "marketing@example.test", position: "Marketing Lead", department: "Marketing", joinedOn: "2023-04-03", region: "Bali" },
  u6: { email: "finance@example.test", position: "Finance Staff", department: "Finance", joinedOn: "2024-07-22", region: "Bali" },
  u7: { email: "admin@example.test", position: "System Admin", department: "IT", joinedOn: "2023-01-02", region: "Head office" },
  u8: { email: "designer@example.test", position: "Graphic Designer", department: "Marketing", joinedOn: "2026-08-18", region: "Bali" },
};
const ROLE_MAP: Record<string, (typeof schema.roleEnum.enumValues)[number]> = {
  manager: "sales_manager",
  sales: "sales",
  marketing: "marketing",
  designer: "designer",
  finance: "finance",
  admin: "admin",
};

const STAGE_MAP: Record<string, (typeof schema.opportunityStageEnum.enumValues)[number]> = {
  New: "new", Contacted: "contacted", Sampling: "sampling", Quotation: "quotation",
  Negotiation: "negotiation", Won: "won", Lost: "lost",
};
const STAGE_PROB: Record<string, number> = { New: 10, Contacted: 20, Sampling: 35, Quotation: 55, Negotiation: 75, Won: 100, Lost: 0 };
const TASK_MAP: Record<string, (typeof schema.taskStatusEnum.enumValues)[number]> = {
  todo: "open", doing: "in_progress", approval: "waiting_approval", done: "done",
};
const CONTENT_MAP: Record<string, (typeof schema.contentStatusEnum.enumValues)[number]> = {
  "Draft brief": "draft_brief", "Ready for design": "ready_for_design", "In design": "in_design",
  "In review": "in_review", Revision: "revision", Approved: "approved", Scheduled: "scheduled", Published: "published",
};
const ACCOUNT_SOURCE: Record<string, string> = {
  A01: "Referral", A02: "Instagram", A03: "Website", A04: "Event / Exhibition", A05: "Instagram", A06: "Walk-in Store",
  A07: "Event / Exhibition", A08: "WhatsApp", A09: "Website", A10: "Referral", A11: "Website", A12: "Event / Exhibition",
};
const ACCOUNT_SCORE: Record<string, [number, "hot" | "warm" | "cold", string]> = {
  A01: [91, "hot", "120-room resort, repeat buyer, decision maker engaged"],
  A02: [74, "warm", "Monthly spa consumables; small volume per order"],
  A03: [68, "warm", "Villa group sampling welcome kits; budget not confirmed"],
  A04: [88, "hot", "Spa menu launch in negotiation; strong repeat history"],
  A05: [52, "warm", "Trial stage; last visit fee evidence rejected"],
  A06: [70, "warm", "Steady retail partner; consignment sell-through 78%"],
  A07: [63, "warm", "Good sell-through, lost one bundle on price"],
  A08: [41, "cold", "New store, tester packaging concern"],
  A09: [84, "hot", "Year-end hampers 180 boxes, PO expected this month"],
  A10: [66, "warm", "Lunar New Year brief pending"],
  A11: [58, "warm", "New resort, intro meeting scheduled"],
  A12: [35, "cold", "Event-only account, low B2B potential"],
};
const LEAD_SCORE: Record<string, [number, "hot" | "warm" | "cold", string]> = {
  L01: [82, "hot", "Boutique hotel asking for refill pricing — matches Hotel & Spa criteria"],
  L02: [71, "warm", "6 treatment rooms, interested in massage oil"],
  L03: [77, "hot", "250 hamper boxes, year-end timeline"],
  L04: [64, "warm", "Met at expo, needs follow-up"],
  L05: [55, "warm", "Pharmacy retail, single SKU interest"],
  L06: [38, "cold", "Small lobby corner, low volume"],
  L07: [20, "cold", "Budget per box below minimum"],
  L08: [69, "warm", "Plastic-free amenities fit our refill range"],
};

async function main() {
  const optional = process.argv.includes("--optional");
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    if (optional) return console.log("DATABASE_URL not set — skipping seed.");
    throw new Error("DATABASE_URL is not set");
  }

  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema, casing: "snake_case" });

  try {
    const [marker] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.sku, MARKER_SKU))
      .limit(1);
    // Reuse the existing demo password if logins already exist.
    const [existing] = await db
      .select({ hash: schema.users.passwordHash })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) in ('admin@example.test','manager@example.test','sales@example.test') and ${schema.users.passwordHash} is not null`)
      .limit(1);

    let passwordHash = existing?.hash ?? null;
    if (marker) {
      if (passwordHash) await ensureExtraDemoUsers(db, passwordHash);
      await db.transaction(async (tx) => {
        await ensureBatch1Demo(tx as unknown as Db);
        await ensureBatch2Demo(tx as unknown as Db);
        await ensureBatch3Demo(tx as unknown as Db);
        await ensureBatch4Demo(tx as unknown as Db);
      });
      return console.log("Demo data already present — skipping seed (batch 1 demo data checked).");
    }
    if (!passwordHash) {
      const password = process.env.SEED_ADMIN_PASSWORD;
      if (!password) {
        if (optional) return console.log("SEED_ADMIN_PASSWORD not set — skipping seed.");
        throw new Error("Set SEED_ADMIN_PASSWORD (min. 10 characters) before seeding");
      }
      if (password.length < 10) throw new Error("SEED_ADMIN_PASSWORD must be at least 10 characters");
      passwordHash = await bcrypt.hash(password, 12);
    }

    await db.transaction(async (tx) => {
      await removeOldMinimalSeed(tx as unknown as Db);
      await seedDemo(tx as unknown as Db, passwordHash!);
      await ensureExtraDemoUsers(tx as unknown as Db, passwordHash!);
      await ensureBatch1Demo(tx as unknown as Db);
      await ensureBatch2Demo(tx as unknown as Db);
      await ensureBatch3Demo(tx as unknown as Db);
      await ensureBatch4Demo(tx as unknown as Db);
    });
    console.log("Seeded demo data: 8 users, 14 products, 12 accounts, leads, deals, quotations, orders (+12-month history), visits, tasks, campaigns, events, content.");
  } finally {
    await client.end();
  }
}

/* ── batch 1: products units, contact notes, activity log, document settings ── */
const unitFor = (sku: string) =>
  sku.startsWith("RF-") ? "jerrycan" : sku.startsWith("CA-") || sku.startsWith("BB-") || sku.startsWith("BS-") ? "jar" : sku.startsWith("GB-") ? "box" : sku.startsWith("AK-") ? "set" : "bottle";
const CONTACT_NOTES: Record<string, string> = {
  A01: "Prefers WhatsApp before 10:00. Approves anything above Rp 50 jt with the GM.",
  A04: "Purchasing visits Bali monthly — good time for samples.",
  A07: "Pays by transfer on the 25th. Ask for the PO number on every order.",
  A09: "Gift season starts in November; needs mock-ups 3 weeks ahead.",
};
const QUOTE_TERMS =
  "Prices in Indonesian Rupiah. Delivery within Bali 3–5 working days after the deposit is received. This quotation is valid until the date shown.";
/** Demo order that came from an accepted demo quotation. */
const QUOTE_FOR_ORDER: Record<string, string> = { "SO-2610-021": "Q-2609-011" };

const DEMO_ACTIVITIES: { acc: string; deal?: string; user: string; type: string; at: [string, string]; notes: string }[] = [
  { acc: "A01", deal: "amenities q1", user: "sales@example.test", type: "Call", at: ["2026-10-30", "10:15"], notes: "GM agrees on 50% deposit; wants delivery split in two batches (Jan / Feb)." },
  { acc: "A01", user: "sales@example.test", type: "WhatsApp", at: ["2026-10-24", "08:40"], notes: "Sent photos of the new lemongrass amenity line. They'll test in 5 rooms." },
  { acc: "A02", user: "sales@example.test", type: "Meeting", at: ["2026-10-28", "14:00"], notes: "Spa manager tasted the massage oil range. Asked for a 5% volume discount — sent quotation." },
  { acc: "A03", user: "sales@example.test", type: "Email", at: ["2026-10-27", "16:20"], notes: "Shared welcome-kit price list and sample delivery date." },
  { acc: "A04", user: "putu@example.test", type: "Call", at: ["2026-10-29", "11:00"], notes: "Purchasing confirmed the refill order; asked for invoice copy by email." },
  { acc: "A05", user: "putu@example.test", type: "WhatsApp", at: ["2026-10-31", "09:05"], notes: "Confirmed the repeat order for November, delivery next week." },
  { acc: "A06", user: "sales@example.test", type: "Note", at: ["2026-10-22", "17:30"], notes: "Shelf space moved next to the entrance — sell-through up since mid-October." },
  { acc: "A07", user: "dewi@example.test", type: "Call", at: ["2026-10-26", "13:10"], notes: "Customer rejected Q-2609-004 (price). Keep in touch for Q1 restock." },
  { acc: "A08", user: "dewi@example.test", type: "Meeting", at: ["2026-10-30", "15:30"], notes: "Owner wants a 15% opening discount for 3 SKUs. Sent to manager for approval." },
  { acc: "A09", user: "dewi@example.test", type: "Email", at: ["2026-10-29", "10:00"], notes: "Sent hamper mock-ups (3 options). Decision by the HR team next Tuesday." },
  { acc: "A10", user: "dewi@example.test", type: "Call", at: ["2026-10-20", "11:45"], notes: "Hampers partner plans Lebaran gifting volume — call again in January." },
  { acc: "A11", user: "sales@example.test", type: "Meeting", at: ["2026-10-25", "10:30"], notes: "Site visit with the spa director; interested in a signature scent for the lobby." },
  { acc: "A12", user: "marketing@example.test", type: "Note", at: ["2026-10-18", "18:00"], notes: "Pop-up booth confirmed for the Sanur Weekend Market." },
];

/**
 * Batch 1 demo data. Idempotent: runs on a fresh seed and on databases that
 * were seeded before batch 1 (e.g. staging), without touching later edits.
 */
async function ensureBatch1Demo(db: Db) {
  // Products: units for the demo SKUs that still have the default.
  for (const unit of ["bottle", "jar", "jerrycan", "box", "set"]) {
    const skus = demo.products.map((p) => p.sku).filter((sku) => unitFor(sku) === unit);
    if (skus.length) await db.update(schema.products).set({ unit }).where(and(eq(schema.products.unit, "pcs"), inArray(schema.products.sku, skus)));
  }

  // Document settings (dummy company details — replace in Settings → Document Templates).
  await db
    .insert(schema.appSettings)
    .values({
      key: "company",
      value: {
        name: "BOEMI Botanicals",
        address: "Jl. Contoh No. 1, Ubud, Gianyar, Bali 80571 (demo address)",
        phone: "+62 361 000 000",
        email: "sales@example.test",
        taxId: "",
        bank: "Bank Demo · 000 000 0000 · a.n. BOEMI Botanicals (dummy)",
      },
    })
    .onConflictDoNothing();

  // Counters continue after the numbers already used (Q-YYMM-NNN / SO-YYMM-NNN).
  await db.execute(sql`
    insert into document_counters (doc_type, period, last_seq)
    select 'quotation', '20' || substring(quote_no from 3 for 4), max(substring(quote_no from 8)::int)
      from quotations where quote_no ~ '^Q-[0-9]{4}-[0-9]+$' group by 2
    union all
    select 'order', '20' || substring(order_no from 4 for 4), max(substring(order_no from 9)::int)
      from orders where order_no ~ '^SO-[0-9]{4}-[0-9]+$' group by 2
    on conflict (doc_type, period) do update set last_seq = greatest(document_counters.last_seq, excluded.last_seq)`);

  // Quotations seeded before batch 1: terms + sent/decided timestamps; the accepted one is linked to its order.
  await db.execute(sql`update quotations set terms = ${QUOTE_TERMS} where terms is null`);
  await db.execute(sql`update quotations set sent_at = (issued_on + time '15:00') at time zone 'Asia/Jakarta' where sent_at is null and status <> 'draft'`);
  await db.execute(sql`update quotations set decided_at = (issued_on + time '16:00') at time zone 'Asia/Jakarta' where decided_at is null and status in ('accepted','rejected')`);
  for (const [orderNo, quoteNo] of Object.entries(QUOTE_FOR_ORDER)) {
    await db.execute(sql`update orders set quotation_id = (select id from quotations where quote_no = ${quoteNo})
      where order_no = ${orderNo} and quotation_id is null
        and not exists (select 1 from orders o2 join quotations q on q.id = o2.quotation_id where q.quote_no = ${quoteNo})`);
  }

  // Targets for every metric (current + last month), never overwriting saved ones.
  const reps = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.role, ["sales"]));
  const period = D("2026-11-01").slice(0, 7);
  const lastPeriod = D("2026-10-01").slice(0, 7);
  const base: Record<string, number> = { "sales@example.test": 250_000_000, "dewi@example.test": 300_000_000, "putu@example.test": 180_000_000 };
  const targetRows = reps.flatMap((r) =>
    [period, lastPeriod].flatMap((pp) => [
      { userId: r.id, metric: "revenue", period: pp, target: pp === period ? (base[r.email] ?? 150_000_000) : Math.round(((base[r.email] ?? 150_000_000) * 0.9) / 1e6) * 1e6 },
      { userId: r.id, metric: "visits", period: pp, target: 12 },
      { userId: r.id, metric: "orders", period: pp, target: 5 },
      { userId: r.id, metric: "new_customers", period: pp, target: pp === period ? 2 : 1 },
    ]),
  );
  if (targetRows.length) await db.insert(schema.kpiTargets).values(targetRows).onConflictDoNothing();

  // The rest only once (the activity log is the marker).
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.activities);
  if (n > 0) return;

  const users = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users);
  const uid = Object.fromEntries(users.map((u) => [u.email, u.id]));
  const accounts = await db.select({ id: schema.customers.id, ref: schema.customers.externalRef }).from(schema.customers).where(sql`${schema.customers.externalRef} like 'demo-%'`);
  const acc = Object.fromEntries(accounts.map((a) => [a.ref!.slice(5), a.id]));
  const deals = await db.select({ id: schema.opportunities.id, title: schema.opportunities.title, customerId: schema.opportunities.customerId }).from(schema.opportunities);
  const contacts = await db.select({ id: schema.contacts.id, customerId: schema.contacts.customerId, dm: schema.contacts.isDecisionMaker }).from(schema.contacts);

  const rows = DEMO_ACTIVITIES.filter((a) => acc[a.acc] && uid[a.user]).map((a) => ({
    type: a.type,
    occurredAt: T(a.at[0], a.at[1]),
    notes: a.notes,
    customerId: acc[a.acc],
    opportunityId: a.deal ? (deals.find((d) => d.customerId === acc[a.acc] && d.title.toLowerCase().includes(a.deal!.toLowerCase()))?.id ?? null) : null,
    contactId: a.type === "Note" ? null : (contacts.find((c) => c.customerId === acc[a.acc] && c.dm)?.id ?? null),
    userId: uid[a.user],
  }));
  if (rows.length) await db.insert(schema.activities).values(rows);

  // Contact notes for demo accounts (only where empty).
  for (const [ref, note] of Object.entries(CONTACT_NOTES)) {
    if (acc[ref]) await db.execute(sql`update contacts set notes = ${note} where customer_id = ${acc[ref]} and is_decision_maker and notes is null`);
  }

  // Campaign links for a few demo accounts.
  const campaigns = await db.select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns);
  for (const [ref, name] of [["A12", "Rempah Body Butter Launch"], ["A09", "Year-end Hampers"], ["A11", "B2B Outreach Hotel Bali Q4"]]) {
    const c = campaigns.find((x) => x.name === name);
    if (c && acc[ref]) await db.update(schema.customers).set({ campaignId: c.id }).where(sql`${schema.customers.id} = ${acc[ref]} and ${schema.customers.campaignId} is null`);
  }

  // A draft quotation whose discount is above the sales limit → waits for the manager.
  const [dewi, a08] = [uid["dewi@example.test"], acc.A08];
  const products = await db.select({ id: schema.products.id, sku: schema.products.sku, price: schema.products.price }).from(schema.products).where(inArray(schema.products.sku, ["BW-SEN-250", "CA-SEN-180", "RS-TAN-100"]));
  if (dewi && a08 && products.length) {
    const tier = tierForSegment("Retail Partner");
    const lines = products.map((p, i) => {
      const unit = unitPrice(p.price ?? 0, tier);
      const quantity = [48, 24, 36][i] ?? 24;
      return { productId: p.id, quantity, unitPrice: unit, subtotal: unit * quantity };
    });
    const totals = lineTotals(lines, 15, true);
    const issued = D("2026-10-31");
    const yymm = issued.slice(2, 4) + issued.slice(5, 7);
    const [counter] = await db.execute<{ last_seq: number }>(sql`
      insert into document_counters (doc_type, period, last_seq) values ('quotation', ${"20" + yymm}, 1)
      on conflict (doc_type, period) do update set last_seq = document_counters.last_seq + 1 returning last_seq`);
    const quoteNo = `Q-${yymm}-${String(Number((counter as { last_seq: number }).last_seq)).padStart(3, "0")}`;
    const validUntil = new Date(Date.parse(`${issued}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
    const [q] = await db
      .insert(schema.quotations)
      .values({
        quoteNo,
        customerId: a08,
        ownerId: dewi,
        status: "draft",
        issuedOn: issued,
        validUntil,
        priceTier: tier,
        subtotal: totals.subtotal,
        discountPct: 15,
        ppn: true,
        taxAmount: totals.taxAmount,
        total: totals.total,
        terms: QUOTE_TERMS,
        notes: "Opening order for the new store corner.",
        approval: "pending",
      })
      .returning({ id: schema.quotations.id });
    await db.insert(schema.quotationItems).values(lines.map((l) => ({ ...l, quotationId: q.id })));
    await db.insert(schema.auditLogs).values({ actorId: dewi, action: "create", entity: "quotation", entityId: quoteNo, changes: { discountPct: 15 } });
  }
}

/** Batch 2: two past imports so "Recent imports" isn't empty (audit rows only; idempotent). */
async function ensureBatch2Demo(db: Db) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.auditLogs).where(eq(schema.auditLogs.action, "import"));
  if (n > 0) return;
  const people = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.email, ["manager@example.test", "admin@example.test"]));
  const id = (e: string) => people.find((p) => p.email === e)?.id ?? null;
  await db.insert(schema.auditLogs).values([
    { actorId: id("manager@example.test"), action: "import", entity: "leads", entityId: "leads-pameran-oktober.csv", changes: { rows: 38, created: 34, updated: 0, skipped: 3, failed: 1, duplicates: "skip" }, createdAt: T("2026-10-21", "10:12") },
    { actorId: id("admin@example.test"), action: "import", entity: "products", entityId: "pricelist-2026-q4.csv", changes: { rows: 14, created: 0, updated: 14, skipped: 0, failed: 0, duplicates: "update" }, createdAt: T("2026-10-02", "09:30") },
  ]);
}

/** Batch 3: planned visits and timed tasks for the next two weeks (calendar), one user's notification settings. */
async function ensureBatch3Demo(db: Db) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.visits).where(eq(schema.visits.status, "planned"));
  if (n > 0) return;
  const users = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users);
  const uid = (e: string) => users.find((u) => u.email === e)?.id;
  const accounts = await db.select({ id: schema.customers.id, ref: schema.customers.externalRef }).from(schema.customers).where(sql`${schema.customers.externalRef} like 'demo-%'`);
  const acc = (ref: string) => accounts.find((a) => a.ref === `demo-${ref}`)?.id;
  const day = (plus: number, hhmm: string) => new Date(`${new Date(jakartaToday() + plus * 86_400_000).toISOString().slice(0, 10)}T${hhmm}:00+07:00`);

  const visits: [string, string, number, string, string][] = [
    ["sales@example.test", "A01", 1, "10:00", "Product demo"],
    ["sales@example.test", "A03", 2, "14:00", "Sample delivery"],
    ["sales@example.test", "A11", 4, "09:30", "Account visit"],
    ["sales@example.test", "A06", 8, "11:00", "Restock check"],
    ["dewi@example.test", "A09", 1, "13:30", "Product demo"],
    ["dewi@example.test", "A08", 3, "10:00", "Account visit"],
    ["dewi@example.test", "A07", 9, "15:00", "Payment collection"],
    ["putu@example.test", "A04", 2, "09:00", "Restock check"],
    ["putu@example.test", "A05", 6, "13:00", "Account visit"],
    ["putu@example.test", "A04", 12, "10:30", "Product demo"],
  ];
  const visitRows = visits
    .filter(([e, a]) => uid(e) && acc(a))
    .map(([e, a, plus, hhmm, purpose]) => ({ customerId: acc(a)!, salesId: uid(e)!, status: "planned" as const, scheduledAt: day(plus, hhmm), purpose }));
  if (visitRows.length) await db.insert(schema.visits).values(visitRows);

  const tasks: [string, string | null, number, string, string, string][] = [
    ["sales@example.test", "A01", 0, "16:00", "Call", "Confirm demo agenda with the GM"],
    ["sales@example.test", "A02", 3, "11:00", "Send samples", "Send massage oil samples (3 scents)"],
    ["dewi@example.test", "A09", 2, "09:00", "Follow-up", "Follow up hamper mock-up decision"],
    ["dewi@example.test", "A10", 5, "15:30", "Call", "Lebaran volume planning call"],
    ["putu@example.test", "A05", 4, "10:00", "WhatsApp", "Share new price list"],
    ["manager@example.test", null, 1, "08:30", "Meeting", "Weekly sales meeting"],
    ["manager@example.test", null, 8, "08:30", "Meeting", "Weekly sales meeting"],
    ["marketing@example.test", null, 2, "14:00", "Brief", "Brief designer: December campaign visuals"],
  ];
  const taskRows = tasks
    .filter(([e]) => uid(e))
    .map(([e, a, plus, hhmm, type, title]) => ({ title, type, customerId: a ? (acc(a) ?? null) : null, assigneeId: uid(e)!, createdBy: uid(e)!, status: "open" as const, dueAt: day(plus, hhmm) }));
  if (taskRows.length) await db.insert(schema.tasks).values(taskRows);

  // Komang prefers fewer emails: no email for stage changes and new leads.
  const komang = uid("sales@example.test");
  if (komang) {
    await db
      .insert(schema.notificationPreferences)
      .values([
        { userId: komang, type: "opportunity.stage_changed", inApp: true, email: false, push: true },
        { userId: komang, type: "lead.hot", inApp: true, email: false, push: true },
      ])
      .onConflictDoNothing();
  }
}

/**
 * Batch 4: departments + heads, reporting lines for the new roles, an extra
 * two-step visit-fee workflow, and approval requests for everything that is
 * pending (fresh databases get their fees from the seed, after the migration ran).
 */
async function ensureBatch4Demo(db: Db) {
  const deps: [string, string, string | null, string | null][] = [
    // code, name, parent code, head email
    ["SALES", "Sales", null, "manager@example.test"],
    ["MARKETING", "Marketing", null, "marketing@example.test"],
    ["CONTENT-DESIGN", "Content Design", "MARKETING", null],
    ["FINANCE", "Finance", null, "finance@example.test"],
    ["IT", "IT", null, "admin@example.test"],
    ["MANAGEMENT", "Management", null, "owner@example.test"],
  ];
  const users = await db.select({ id: schema.users.id, email: schema.users.email, department: schema.users.department, departmentId: schema.users.departmentId }).from(schema.users);
  const uid = (e: string | null) => (e ? users.find((u) => u.email === e)?.id ?? null : null);
  for (const [code, name, , head] of deps) {
    await db.insert(schema.departments).values({ code, name, headUserId: uid(head) }).onConflictDoNothing();
  }
  const all = await db.select().from(schema.departments);
  const byCode = new Map(all.map((d) => [d.code, d]));
  for (const [code, , parent, head] of deps) {
    const d = byCode.get(code)!;
    const patch: Partial<typeof schema.departments.$inferInsert> = {};
    if (parent && !d.parentId) patch.parentId = byCode.get(parent)?.id;
    if (head && !d.headUserId) patch.headUserId = uid(head);
    if (Object.keys(patch).length) await db.update(schema.departments).set(patch).where(eq(schema.departments.id, d.id));
  }
  // Place people (only those without a department id yet).
  const placement: Record<string, string> = { "designer@example.test": "CONTENT-DESIGN" };
  for (const u of users) {
    if (u.departmentId) continue;
    const code = placement[u.email] ?? (u.department ? u.department.toUpperCase().replace(/[^A-Z0-9]+/g, "-") : null);
    const d = code ? byCode.get(code) : undefined;
    if (d) await db.update(schema.users).set({ departmentId: d.id, department: d.name }).where(eq(schema.users.id, u.id));
  }
  // Reporting lines for the new demo roles.
  const manager = uid("manager@example.test");
  const owner = uid("owner@example.test");
  if (manager && uid("staff@example.test")) await db.update(schema.users).set({ managerId: manager }).where(and(eq(schema.users.email, "staff@example.test"), sql`${schema.users.managerId} is null`));
  if (owner && uid("pm@example.test")) await db.update(schema.users).set({ managerId: owner }).where(and(eq(schema.users.email, "pm@example.test"), sql`${schema.users.managerId} is null`));

  // Extra workflow: bigger visit fees need the direct manager, then Finance.
  const [big] = await db.select({ id: schema.approvalFlows.id }).from(schema.approvalFlows).where(eq(schema.approvalFlows.name, "Visit fee from Rp 500,000: manager then finance"));
  if (!big) {
    const [f] = await db
      .insert(schema.approvalFlows)
      .values({ entityType: "visit_fee", name: "Visit fee from Rp 500,000: manager then finance", minAmount: 500_000, priority: 50 })
      .returning({ id: schema.approvalFlows.id });
    await db.insert(schema.approvalFlowSteps).values([
      { flowId: f.id, position: 1, approverType: "direct_manager", label: "Direct manager" },
      { flowId: f.id, position: 2, approverType: "role", roles: ["finance"], label: "Finance" },
    ]);
  }

  // Requests for pending fees / discounts that don't have one yet (default flows, step 1 = role step).
  await db.execute(sql`
    insert into approval_requests (flow_id, entity_type, entity_id, amount, title, link, requester_id, status, current_step, created_at)
    select '00000000-0000-4000-8000-000000000001', 'visit_fee', f.id, f.amount, 'Visit fee · ' || c.name || ' · ' || u.name, '/sales/visits?fee=pending', f.requested_by, 'pending', 1, f.created_at
      from visit_fees f join visits v on v.id = f.visit_id join customers c on c.id = v.customer_id join users u on u.id = f.requested_by
     where f.status = 'pending' and not exists (select 1 from approval_requests r where r.entity_type = 'visit_fee' and r.entity_id = f.id)
       and exists (select 1 from approval_flows where id = '00000000-0000-4000-8000-000000000001')`);
  await db.execute(sql`
    insert into approval_requests (flow_id, entity_type, entity_id, amount, title, link, requester_id, status, current_step, created_at)
    select '00000000-0000-4000-8000-000000000002', 'quotation_discount', q.id, ceil(q.discount_pct)::bigint, q.quote_no || ' · ' || q.discount_pct || '% discount · ' || c.name, '/sales/quotations/' || q.id, q.owner_id, 'pending', 1, q.created_at
      from quotations q join customers c on c.id = q.customer_id
     where q.approval = 'pending' and q.owner_id is not null and not exists (select 1 from approval_requests r where r.entity_type = 'quotation_discount' and r.entity_id = q.id)
       and exists (select 1 from approval_flows where id = '00000000-0000-4000-8000-000000000002')`);
  await db.execute(sql`
    insert into approval_actions (request_id, position, label, approver_type, roles, approver_ids, status)
    select r.id, 1, s.label, s.approver_type, s.roles,
           coalesce(nullif(array(select u.id from users u where u.active and u.role::text = any (s.roles) and u.id <> r.requester_id), '{}'),
                    array(select u.id from users u where u.active and u.role = 'admin' and u.id <> r.requester_id)),
           'pending'
      from approval_requests r join approval_flow_steps s on s.flow_id = r.flow_id and s.position = 1
     where r.status = 'pending' and not exists (select 1 from approval_actions a where a.request_id = r.id)`);
}

/** Personas added after the first demo seed (safe to run on every deploy). */
async function ensureExtraDemoUsers(db: Db, passwordHash: string) {
  const extras = [
    { email: "owner@example.test", name: "BOEMI Owner", role: "executive" as const, position: "Owner / Director", department: "Management", region: "All regions" },
    // Batch 4 roles
    { email: "staff@example.test", name: "Made Wirawan", role: "staff" as const, position: "Customer Service", department: "Sales", region: "Bali" },
    { email: "pm@example.test", name: "Rizky Pratama", role: "project_manager" as const, position: "Project Manager", department: "Management", region: "Bali" },
  ];
  for (const u of extras) {
    const [row] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${u.email}`).limit(1);
    if (!row) {
      await db.insert(schema.users).values({ ...u, passwordHash, joinedOn: "2023-01-02", active: true });
      console.log(`Added demo user ${u.email}`);
    }
  }
}

/** Rows created by the first scaffold seed. */
async function removeOldMinimalSeed(db: Db) {
  const old = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(inArray(schema.customers.name, ["Toko Contoh Satu", "Spa Contoh Dua"]));
  if (old.length) {
    await db.delete(schema.customers).where(inArray(schema.customers.id, old.map((c) => c.id)));
  }
  await db.delete(schema.products).where(inArray(schema.products.sku, ["DEMO-SPRAY-01", "DEMO-OIL-01"]));
  await db.delete(schema.qualificationCriteria);
}

async function seedDemo(db: Db, passwordHash: string) {
  /* ── users ── */
  const userId: Record<string, string> = {};
  for (const u of demo.users) {
    const p = PERSONAS[u.id];
    const values = {
      name: u.n,
      email: p.email,
      role: ROLE_MAP[u.role],
      region: p.region,
      position: p.position,
      department: p.department,
      joinedOn: p.joinedOn,
      passwordHash,
      active: true,
    };
    const [row] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${p.email}`)
      .limit(1);
    if (row) {
      await db.update(schema.users).set(values).where(eq(schema.users.id, row.id));
      userId[u.id] = row.id;
    } else {
      const [ins] = await db.insert(schema.users).values(values).returning({ id: schema.users.id });
      userId[u.id] = ins.id;
    }
  }
  for (const k of ["u2", "u3", "u4", "u5", "u6", "u8"]) {
    await db.update(schema.users).set({ managerId: userId.u1 }).where(eq(schema.users.id, userId[k]));
  }

  /* ── products ── */
  const productRows = await db
    .insert(schema.products)
    .values(
      demo.products.map((p) => ({
        sku: p.sku,
        name: p.n,
        category: p.cat,
        variant: p.size,
        unit: unitFor(p.sku),
        price: p.price,
        stock: p.stock,
        active: p.active,
      })),
    )
    .returning({ id: schema.products.id, sku: schema.products.sku, price: schema.products.price });
  const productId = Object.fromEntries(productRows.map((p) => [p.sku, p.id]));
  const priceOf = Object.fromEntries(productRows.map((p) => [p.sku, p.price ?? 0]));

  /* ── campaigns ── */
  const campaignWindows: Record<string, [string, string]> = {
    "Rempah Body Butter Launch": ["2026-10-01", "2026-11-30"],
    "B2B Outreach Hotel Bali Q4": ["2026-10-01", "2026-12-31"],
    "Year-end Hampers": ["2026-11-01", "2026-12-31"],
    "Wanita Bisa Movement 2026": ["2026-08-01", "2026-08-31"],
  };
  const campaignRows = await db
    .insert(schema.campaigns)
    .values(
      demo.campaigns.map((c) => ({
        name: c.n,
        type: c.type,
        channel: c.type === "Outbound" ? "Sales outreach" : "Instagram, Website",
        startsOn: D(campaignWindows[c.n][0]),
        endsOn: D(campaignWindows[c.n][1]),
        budget: c.budget,
        status: c.st.toLowerCase() as "running" | "scheduled" | "done",
        resultLeads: c.leads,
        resultRevenue: c.rev,
        ownerId: userId.u5,
      })),
    )
    .returning({ id: schema.campaigns.id, name: schema.campaigns.name });
  const campaignId = Object.fromEntries(campaignRows.map((c) => [c.name, c.id]));

  /* ── accounts (customers) + contacts ── */
  const accountId: Record<string, string> = {};
  const accountSeg: Record<string, string> = {};
  const accountsWithOrders = new Set(demo.orders.map((o) => o.acc));
  for (const a of demo.accounts) {
    const [score, tier, reason] = ACCOUNT_SCORE[a.id];
    const firstPhone = a.contacts[0]?.[2];
    const [row] = await db
      .insert(schema.customers)
      .values({
        name: a.n,
        businessType: a.seg,
        status: accountsWithOrders.has(a.id) || a.since < "2026-06-01" ? "active" : "prospect",
        phoneE164: normalizePhone(firstPhone),
        email: a.contacts[0]?.[3] ?? null,
        city: a.city,
        region: a.city.split(", ").at(-1),
        ownerId: userId[a.owner],
        source: ACCOUNT_SOURCE[a.id],
        externalRef: `demo-${a.id}`,
        marketingConsent: true,
        consentAt: shift(a.since),
        qualificationScore: score,
        qualificationTier: tier,
        qualificationReason: reason,
        qualifiedAt: T("2026-11-01", "07:00"),
        createdAt: shift(a.since),
      })
      .returning({ id: schema.customers.id });
    accountId[a.id] = row.id;
    accountSeg[a.id] = a.seg;
    if (a.contacts.length) {
      await db.insert(schema.contacts).values(
        a.contacts.map(([name, position, phone, email], i) => ({
          customerId: row.id,
          name,
          position,
          phoneE164: normalizePhone(phone),
          email,
          isDecisionMaker: i === 0,
          notes: i === 0 ? (CONTACT_NOTES[a.id] ?? null) : null,
        })),
      );
    }
  }

  const priced = (acc: string, items: Item[], discountPct = 0, ppn = true) => {
    const tier = tierForSegment(accountSeg[acc]);
    const lines = items.map(([sku, qty]) => {
      const unit = unitPrice(priceOf[sku], tier);
      return { productId: productId[sku], quantity: qty, unitPrice: unit, subtotal: unit * qty };
    });
    return { tier, lines, ...lineTotals(lines, discountPct, ppn) };
  };

  /* ── leads ── */
  const leadRows = await db
    .insert(schema.leads)
    .values(
      demo.leads.map((l) => {
        const [score, tier, reason] = LEAD_SCORE[l.id];
        return {
          company: l.co,
          picName: l.pic,
          phoneE164: normalizePhone(l.ph),
          segment: l.seg,
          city: l.city,
          source: l.src,
          campaignId: l.seg === "Hotel & Spa" && l.src !== "Referral" ? campaignId["B2B Outreach Hotel Bali Q4"] : null,
          ownerId: userId[l.owner],
          status: l.st.toLowerCase() as "new" | "contacted" | "disqualified",
          note: l.note,
          disqualifyReason: l.st === "Disqualified" ? "No budget yet" : null,
          qualificationScore: score,
          qualificationTier: tier,
          qualificationReason: reason,
          receivedOn: D(l.dt),
          createdAt: T(l.dt, "10:00"),
        };
      }),
    )
    .returning({ id: schema.leads.id, company: schema.leads.company });
  const leadIdByCompany = Object.fromEntries(leadRows.map((l) => [l.company, l.id]));

  /* ── deals (opportunities) ── */
  const dealId: Record<string, string> = {};
  for (const d of demo.deals) {
    const { subtotal } = priced(d.acc, d.items as Item[]);
    const [row] = await db
      .insert(schema.opportunities)
      .values({
        customerId: accountId[d.acc],
        ownerId: userId[d.owner],
        title: d.t,
        stage: STAGE_MAP[d.st],
        value: subtotal,
        probability: STAGE_PROB[d.st],
        expectedCloseOn: D(d.close),
        lostReason: "lost" in d ? (d.lost as string) : null,
      })
      .returning({ id: schema.opportunities.id });
    dealId[d.id] = row.id;
  }

  /* ── quotations ── */
  const quoteId: Record<string, string> = {};
  for (const q of demo.quotes) {
    const p = priced(q.acc, q.items as Item[], q.disc, q.ppn);
    const [row] = await db
      .insert(schema.quotations)
      .values({
        quoteNo: q.id,
        customerId: accountId[q.acc],
        opportunityId: dealId[q.deal],
        ownerId: userId[q.owner],
        status: q.st.toLowerCase() as "draft" | "sent" | "accepted" | "rejected",
        issuedOn: D(q.dt),
        validUntil: D(q.valid),
        priceTier: p.tier,
        subtotal: p.subtotal,
        discountPct: q.disc,
        ppn: q.ppn,
        taxAmount: p.taxAmount,
        total: p.total,
        terms: QUOTE_TERMS,
        approval: "not_required",
        sentAt: q.st === "Draft" ? null : T(q.dt, "15:00"),
        decidedAt: q.st === "Accepted" || q.st === "Rejected" ? T(q.dt, "16:00") : null,
        notes: q.st === "Rejected" ? "Customer: chose a local supplier for this season." : null,
      })
      .returning({ id: schema.quotations.id });
    quoteId[q.id] = row.id;
    await db.insert(schema.quotationItems).values(p.lines.map((l) => ({ ...l, quotationId: row.id })));
  }

  /* ── orders: demo orders + 11 months of history ── */
  type OrderSeed = {
    no: string; acc: string; at: Date; owner: string; status: (typeof schema.orderStatusEnum.enumValues)[number];
    disc: number; ppn: boolean; dpPct: number; paid: "none" | "dp" | "full"; items: Item[]; ref: string;
    delivery?: "pending" | "shipped" | "delivered";
  };
  const orderSeeds: OrderSeed[] = demo.orders.map((o) => ({
    no: o.id, acc: o.acc, at: T(o.dt, "11:00"), owner: o.owner,
    // Shipped / Delivered are delivery states since batch 1; the order itself is processing.
    status: (["Shipped", "Delivered"].includes(o.st) ? "processing" : o.st.toLowerCase()) as OrderSeed["status"],
    delivery: o.st === "Shipped" ? "shipped" : o.st === "Delivered" || o.st === "Completed" ? "delivered" : "pending",
    disc: o.disc, ppn: o.ppn, dpPct: o.dpPct, paid: o.paid as OrderSeed["paid"], items: o.items as Item[], ref: o.ref,
  }));

  const BASKET: Record<string, Item[]> = {
    "Hotel & Spa": [["AK-HTL-030", 400], ["RF-BW-5000", 8], ["CO-VCO-100", 60], ["BS-ART-200", 40], ["BB-REM-150", 30]],
    "Retail Partner": [["BW-SEN-250", 36], ["CA-SEN-180", 24], ["RS-TAN-100", 24], ["SS-MIN-050", 36], ["BL-TAN-200", 24]],
    "Corporate Gift": [["GB-SIG-001", 60], ["CA-SEN-180", 80], ["HS-SPR-060", 150]],
    "Online & Event": [["BW-SEN-250", 40], ["HS-SPR-060", 60], ["CA-SEN-180", 20]],
  };
  const rand = rng(20261101);
  for (let back = 11; back >= 1; back--) {
    if (back === 1) continue; // last month comes from the demo orders
    const month = new Date(Date.UTC(2026, 10 - back, 1));
    const ym = month.toISOString().slice(0, 7);
    let seq = 40;
    for (const a of demo.accounts) {
      if (a.since.slice(0, 7) > ym) continue;
      const corporatePeak = a.seg === "Corporate Gift" && (ym.endsWith("-12") || ym.endsWith("-01"));
      if (rand() > (corporatePeak ? 0.95 : a.seg === "Corporate Gift" ? 0.3 : 0.85)) continue;
      const basket = BASKET[a.seg];
      const picks = basket.filter(() => rand() < 0.55);
      const items: Item[] = (picks.length ? picks : [basket[0]]).map(([sku, q]) => [
        sku,
        Math.max(6, Math.round((q * (0.5 + rand())) / 6) * 6),
      ]);
      const day = String(3 + Math.floor(rand() * 24)).padStart(2, "0");
      orderSeeds.push({
        no: `SO-${ym.slice(2, 4)}${ym.slice(5, 7)}-${String(seq++).padStart(3, "0")}`,
        acc: a.id,
        at: T(`${ym}-${day}`, "11:00"),
        owner: a.owner,
        status: "completed",
        disc: a.seg === "Corporate Gift" ? 5 : 0,
        ppn: a.seg !== "Online & Event",
        dpPct: a.seg === "Retail Partner" ? 0 : 50,
        paid: "full",
        items,
        ref: "Repeat order",
        delivery: "delivered",
      });
    }
  }

  // Month-to-date orders so targets show realistic progress (demo "achieved" values).
  const todayYmd = new Date(jakartaToday()).toISOString().slice(0, 10);
  const dayOfMonth = Number(todayYmd.slice(8, 10));
  const yymm = todayYmd.slice(2, 4) + todayYmd.slice(5, 7);
  let mtdSeq = 80;
  for (const [rep, t] of Object.entries(demo.targets)) {
    const accs = demo.accounts.filter((a) => a.owner === rep && a.seg !== "Online & Event");
    let remaining = t.base;
    for (let i = 0; i < 3 && remaining > 2_000_000 && accs.length; i++) {
      const a = accs[i % accs.length];
      const basket = BASKET[a.seg];
      const [sku] = basket[i % basket.length];
      const unit = unitPrice(priceOf[sku], tierForSegment(a.seg));
      const portion = i === 2 ? remaining : remaining * 0.55;
      const qty = Math.max(1, Math.round(portion / 1.11 / unit));
      const day = String(Math.max(1, dayOfMonth - 1 - i * 2)).padStart(2, "0");
      orderSeeds.push({
        no: `SO-${yymm}-${String(mtdSeq++).padStart(3, "0")}`,
        acc: a.id,
        at: new Date(`${todayYmd.slice(0, 7)}-${day}T10:30:00+07:00`),
        owner: rep,
        status: i === 0 ? "processing" : "confirmed",
        disc: 0,
        ppn: true,
        dpPct: a.seg === "Retail Partner" ? 0 : 50,
        paid: a.seg === "Retail Partner" ? "none" : "dp",
        items: [[sku, qty]],
        ref: "Repeat order",
      });
      remaining -= qty * unit * 1.11;
    }
  }

  for (const o of orderSeeds) {
    const p = priced(o.acc, o.items, o.disc, o.ppn);
    const paidAmount = o.paid === "full" ? p.total : o.paid === "dp" ? Math.round((p.total * o.dpPct) / 100) : 0;
    const [row] = await db
      .insert(schema.orders)
      .values({
        orderNo: o.no,
        customerId: accountId[o.acc],
        opportunityId: o.ref.startsWith("Deal ") ? dealId[o.ref.slice(5)] : null,
        salesId: userId[o.owner],
        status: o.status,
        orderedAt: o.at,
        subtotal: p.subtotal,
        discountPct: o.disc,
        ppn: o.ppn,
        taxAmount: p.taxAmount,
        total: p.total,
        depositPct: o.dpPct,
        paymentStatus: o.paid === "full" ? "paid" : o.paid === "dp" ? "deposit" : "unpaid",
        paidAmount,
        reference: o.ref,
        channel: accountSeg[o.acc],
        quotationId: QUOTE_FOR_ORDER[o.no] ? quoteId[QUOTE_FOR_ORDER[o.no]] : null,
        deliveryStatus: o.delivery ?? "pending",
        shippedAt: o.delivery && o.delivery !== "pending" ? new Date(o.at.getTime() + 2 * 86_400_000) : null,
        deliveredAt: o.delivery === "delivered" ? new Date(o.at.getTime() + 4 * 86_400_000) : null,
      })
      .returning({ id: schema.orders.id });
    // Payments: a deposit when the order is confirmed, the rest on delivery.
    const day = (d: Date, plus: number) => new Date(d.getTime() + plus * 86_400_000).toISOString().slice(0, 10);
    const deposit = Math.round((p.total * o.dpPct) / 100);
    const pays: (typeof schema.orderPayments.$inferInsert)[] = [];
    if (o.paid !== "none" && o.dpPct > 0) pays.push({ orderId: row.id, kind: "deposit", amount: o.paid === "full" ? deposit : paidAmount, paidOn: day(o.at, 1), method: "Transfer", reference: `TRF-${o.no.slice(3)}-1`, recordedBy: userId.u6 });
    if (o.paid === "full") pays.push({ orderId: row.id, kind: "settlement", amount: p.total - (o.dpPct > 0 ? deposit : 0), paidOn: day(o.at, o.dpPct > 0 ? 9 : 14), method: o.acc === "A12" ? "QRIS" : "Transfer", reference: `TRF-${o.no.slice(3)}-2`, recordedBy: userId.u6 });
    if (pays.length) await db.insert(schema.orderPayments).values(pays);
    await db.insert(schema.orderItems).values(
      p.lines.map((l) => ({ orderId: row.id, productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, subtotal: l.subtotal })),
    );
  }

  /* ── visits + visit fees ── */
  for (const v of demo.visits) {
    const [lat, lng] = v.gps.split(",").map((n) => Number(n.trim()));
    const [visit] = await db
      .insert(schema.visits)
      .values({
        customerId: accountId[v.acc],
        salesId: userId[v.owner],
        status: "completed",
        scheduledAt: T(v.dt, v.check),
        checkedInAt: T(v.dt, v.check),
        latitude: lat,
        longitude: lng,
        purpose: "Account visit",
        notes: v.note,
      })
      .returning({ id: schema.visits.id });
    const status = v.fst.toLowerCase() as "pending" | "approved" | "rejected";
    await db.insert(schema.visitFees).values({
      visitId: visit.id,
      amount: v.fee,
      description: "Transport & parking",
      status,
      requestedBy: userId[v.owner],
      decidedBy: status === "pending" ? null : userId.u6,
      decidedAt: status === "pending" ? null : T(v.dt, "17:00"),
      decisionNote: "rej" in v ? (v.rej as string) : null,
      createdAt: T(v.dt, v.check),
    });
  }

  /* ── tasks & follow-ups ── */
  await db.insert(schema.tasks).values(
    demo.acts.map((t) => ({
      title: t.note,
      type: t.type,
      customerId: accountId[t.acc],
      assigneeId: userId[t.owner],
      createdBy: userId.u1,
      status: TASK_MAP[t.st],
      dueAt: T(t.due, "17:00"),
      completedAt: t.done ? T(t.due, "15:00") : null,
    })),
  );

  /* ── targets (current and last month) ── */
  const period = D("2026-11-01").slice(0, 7);
  const lastPeriod = D("2026-10-01").slice(0, 7);
  const targetRows = Object.entries(demo.targets).flatMap(([u, t]) => [
    { userId: userId[u], metric: "revenue", period, target: t.t },
    { userId: userId[u], metric: "revenue", period: lastPeriod, target: Math.round((t.t * 0.9) / 1e6) * 1e6 },
    { userId: userId[u], metric: "visits", period, target: 12 },
    { userId: userId[u], metric: "visits", period: lastPeriod, target: 12 },
    { userId: userId[u], metric: "orders", period, target: u === "u3" ? 6 : 5 },
    { userId: userId[u], metric: "orders", period: lastPeriod, target: 5 },
    { userId: userId[u], metric: "new_customers", period, target: 2 },
    { userId: userId[u], metric: "new_customers", period: lastPeriod, target: 1 },
  ]);
  await db.insert(schema.kpiTargets).values(targetRows).onConflictDoNothing();

  /* ── events + booth leads ── */
  const eventId: Record<string, string> = {};
  for (const e of demo.events) {
    const [row] = await db
      .insert(schema.events)
      .values({
        name: e.n,
        type: e.type,
        heldOn: D(e.dt),
        location: e.loc,
        status: e.st.toLowerCase() as "scheduled" | "done",
        budget: e.budget,
        actualCost: e.cost,
        visitors: e.visitors,
        leadsCount: e.leads,
        dealsCount: e.deals,
        revenue: e.rev,
        campaignId: e.n.startsWith("Wanita Bisa") ? campaignId["Wanita Bisa Movement 2026"] : null,
        ownerId: userId.u5,
      })
      .returning({ id: schema.events.id });
    eventId[e.n] = row.id;
  }
  await db.insert(schema.eventLeads).values(
    demo.eventLeads.map((l) => ({
      eventId: eventId[l.ev],
      name: l.n,
      company: l.co === "-" ? null : l.co,
      segment: l.seg,
      phoneE164: normalizePhone(l.ph),
      interest: l.int,
      status: (l.st === "Not relevant" ? "not_relevant" : l.st.toLowerCase()) as "new" | "converted" | "not_relevant",
      leadId: l.st === "Converted" ? (leadIdByCompany[l.co] ?? null) : null,
    })),
  );

  /* ── content calendar ── */
  await db.insert(schema.contentItems).values(
    demo.content.map((c) => ({
      title: c.title,
      publishAt: T(c.date, c.time),
      channels: c.ch,
      format: c.format,
      status: CONTENT_MAP[c.st],
      writerId: userId[c.writer],
      designerId: userId[c.designer],
      objective: c.brief.obj,
      keyMessage: c.brief.msg,
      caption: c.brief.cap,
      cta: c.brief.cta,
      hashtags: c.brief.tags,
      products: c.brief.prod,
    })),
  );

  /* ── qualification criteria (client-defined rules) ── */
  await db.insert(schema.qualificationCriteria).values([
    { name: "Target segment", field: "segment", operator: "in", value: ["Hotel & Spa", "Corporate Gift"], weight: 30 },
    { name: "Expected volume ≥ Rp 25M", field: "interests.expectedVolume", operator: "gte", value: 25_000_000, weight: 25 },
    { name: "Decision maker reached", field: "contacts.isDecisionMaker", operator: "equals", value: true, weight: 20 },
    { name: "Marketing consent given", field: "marketingConsent", operator: "equals", value: true, weight: 10 },
    { name: "Located in Bali, Lombok or Jabodetabek", field: "region", operator: "in", value: ["Bali", "NTB", "Jakarta", "Banten"], weight: 15 },
  ]);

  /* ── audit trail + a few notifications ── */
  await db.insert(schema.auditLogs).values([
    { actorId: userId.u6, action: "approve", entity: "visit_fee", entityId: "V03", changes: { status: "approved" }, createdAt: T("2026-10-31", "09:40") },
    { actorId: userId.u2, action: "create", entity: "lead", entityId: "Kayu Manis Boutique Hotel", changes: { source: "Website" }, createdAt: T("2026-10-31", "17:02") },
    { actorId: userId.u4, action: "create", entity: "order", entityId: "SO-2611-001", changes: { total: "auto" }, createdAt: T("2026-11-01", "08:14") },
    { actorId: userId.u6, action: "reject", entity: "visit_fee", entityId: "V05", changes: { reason: "Photo evidence unclear" }, createdAt: T("2026-10-25", "10:05") },
    { actorId: userId.u3, action: "update", entity: "opportunity", entityId: "Year-end hampers 2026", changes: { stage: ["quotation", "negotiation"] }, createdAt: T("2026-10-29", "14:22") },
  ]);
  await db.insert(schema.notifications).values([
    { userId: userId.u1, type: "visit_fee.pending", title: "2 visit fees waiting for approval", link: "/sales/visits", createdAt: T("2026-11-01", "08:00") },
    { userId: userId.u6, type: "visit_fee.pending", title: "2 visit fees waiting for approval", link: "/sales/visits", createdAt: T("2026-11-01", "08:00") },
    { userId: userId.u2, type: "task.overdue", title: "Overdue: Send 10 sample welcome kits to the villa", link: "/sales/tasks", createdAt: T("2026-11-01", "07:00") },
    { userId: userId.u2, type: "lead.hot", title: "New hot lead: Kayu Manis Boutique Hotel", link: "/sales/leads", createdAt: T("2026-10-31", "17:05") },
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
