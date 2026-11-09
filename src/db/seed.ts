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
import { eq, inArray, sql } from "drizzle-orm";
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
      return console.log("Demo data already present — skipping seed.");
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
    });
    console.log("Seeded demo data: 8 users, 14 products, 12 accounts, leads, deals, quotations, orders (+12-month history), visits, tasks, campaigns, events, content.");
  } finally {
    await client.end();
  }
}

/** Personas added after the first demo seed (safe to run on every deploy). */
async function ensureExtraDemoUsers(db: Db, passwordHash: string) {
  const extras = [
    { email: "owner@example.test", name: "BOEMI Owner", role: "executive" as const, position: "Owner / Director", department: "Management", region: "All regions" },
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
      })
      .returning({ id: schema.quotations.id });
    await db.insert(schema.quotationItems).values(p.lines.map((l) => ({ ...l, quotationId: row.id })));
  }

  /* ── orders: demo orders + 11 months of history ── */
  type OrderSeed = {
    no: string; acc: string; at: Date; owner: string; status: (typeof schema.orderStatusEnum.enumValues)[number];
    disc: number; ppn: boolean; dpPct: number; paid: "none" | "dp" | "full"; items: Item[]; ref: string;
  };
  const orderSeeds: OrderSeed[] = demo.orders.map((o) => ({
    no: o.id, acc: o.acc, at: T(o.dt, "11:00"), owner: o.owner,
    status: o.st.toLowerCase() as OrderSeed["status"],
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
      })
      .returning({ id: schema.orders.id });
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
