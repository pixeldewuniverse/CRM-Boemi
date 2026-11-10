import "server-only";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";
import { fdate, rp } from "@/lib/format";
import { canOpen, findNav } from "@/lib/nav";
import { ownedBy } from "@/lib/scope";

export type SearchHit = { id: string; title: string; subtitle?: string; href: string };
export type SearchGroup = { type: string; label: string; href: string; total: number; hits: SearchHit[] };

const PER_TYPE = 5;
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const total = sql<number>`count(*) over ()`.mapWith(Number);
const anyOf = (pattern: string, ...cols: AnyPgColumn[]) => or(...cols.map((c) => ilike(c, pattern))) as SQL;

/**
 * Global search across the CRM. Each type uses the same scope as its list
 * page (sales reps: only their own records) and is skipped entirely when the
 * user's role can't open that page. ILIKE uses the pg_trgm indexes when the
 * extension exists (migration 0007); otherwise it's a plain scan.
 */
export async function searchAll(user: CurrentUser, raw: string): Promise<SearchGroup[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const p = like(q);
  const digits = q.replace(/\D/g, "");
  const phone = digits.length >= 4 ? `%${digits.replace(/^0/, "")}%` : null;
  const db = getDb();
  const c = schema.customers;

  const types: { type: string; label: string; href: string; run: () => Promise<{ hits: SearchHit[]; total: number }> }[] = [
    {
      type: "accounts",
      label: "Accounts",
      href: `/database/accounts?q=${encodeURIComponent(q)}`,
      run: async () => {
        const rows = await db
          .select({ id: c.id, name: c.name, segment: c.businessType, city: c.city, total })
          .from(c)
          .where(and(customerScope(user), or(anyOf(p, c.name, c.email, c.city), phone ? ilike(c.phoneE164, phone) : undefined)))
          .orderBy(c.name)
          .limit(PER_TYPE);
        return { total: rows[0]?.total ?? 0, hits: rows.map((r) => ({ id: r.id, title: r.name, subtitle: [r.segment, r.city].filter(Boolean).join(" · "), href: `/database/accounts/${r.id}` })) };
      },
    },
    {
      type: "contacts",
      label: "Contacts",
      href: `/database/contacts?q=${encodeURIComponent(q)}`,
      run: async () => {
        const k = schema.contacts;
        const rows = await db
          .select({ id: k.id, name: k.name, position: k.position, accountId: c.id, account: c.name, total })
          .from(k)
          .innerJoin(c, eq(c.id, k.customerId))
          .where(and(customerScope(user), or(anyOf(p, k.name, k.email, k.position), phone ? ilike(k.phoneE164, phone) : undefined)))
          .orderBy(k.name)
          .limit(PER_TYPE);
        return { total: rows[0]?.total ?? 0, hits: rows.map((r) => ({ id: r.id, title: r.name, subtitle: [r.position, r.account].filter(Boolean).join(" · "), href: `/database/accounts/${r.accountId}` })) };
      },
    },
    {
      type: "leads",
      label: "Leads",
      href: `/sales/leads?q=${encodeURIComponent(q)}`,
      run: async () => {
        const l = schema.leads;
        const rows = await db
          .select({ id: l.id, company: l.company, pic: l.picName, status: l.status, total })
          .from(l)
          .where(and(ownedBy(user, l.ownerId), or(anyOf(p, l.company, l.picName, l.email), phone ? ilike(l.phoneE164, phone) : undefined)))
          .orderBy(desc(l.receivedOn))
          .limit(PER_TYPE);
        return { total: rows[0]?.total ?? 0, hits: rows.map((r) => ({ id: r.id, title: r.company, subtitle: [r.pic, r.status].filter(Boolean).join(" · "), href: `/sales/leads?q=${encodeURIComponent(r.company)}` })) };
      },
    },
    {
      type: "deals",
      label: "Deals",
      href: "/sales/pipeline",
      run: async () => {
        const o = schema.opportunities;
        const rows = await db
          .select({ id: o.id, title: o.title, stage: o.stage, value: o.value, accountId: c.id, account: c.name, total })
          .from(o)
          .innerJoin(c, eq(c.id, o.customerId))
          .where(and(ownedBy(user, o.ownerId), anyOf(p, o.title, c.name)))
          .orderBy(desc(o.updatedAt))
          .limit(PER_TYPE);
        return { total: rows[0]?.total ?? 0, hits: rows.map((r) => ({ id: r.id, title: r.title, subtitle: `${r.account} · ${r.stage} · ${rp(r.value)}`, href: `/database/accounts/${r.accountId}` })) };
      },
    },
    {
      type: "quotations",
      label: "Quotations",
      href: "/sales/quotations",
      run: async () => {
        const t = schema.quotations;
        const rows = await db
          .select({ id: t.id, no: t.quoteNo, status: t.status, total: t.total, account: c.name, n: total })
          .from(t)
          .innerJoin(c, eq(c.id, t.customerId))
          .where(and(ownedBy(user, t.ownerId), anyOf(p, t.quoteNo, c.name)))
          .orderBy(desc(t.issuedOn))
          .limit(PER_TYPE);
        return { total: rows[0]?.n ?? 0, hits: rows.map((r) => ({ id: r.id, title: r.no, subtitle: `${r.account} · ${r.status} · ${rp(r.total)}`, href: `/sales/quotations/${r.id}` })) };
      },
    },
    {
      type: "orders",
      label: "Orders",
      href: "/sales/orders",
      run: async () => {
        const o = schema.orders;
        const rows = await db
          .select({ id: o.id, no: o.orderNo, at: o.orderedAt, total: o.total, account: c.name, n: total })
          .from(o)
          .innerJoin(c, eq(c.id, o.customerId))
          .where(and(ownedBy(user, o.salesId), anyOf(p, o.orderNo, o.reference, c.name)))
          .orderBy(desc(o.orderedAt))
          .limit(PER_TYPE);
        return { total: rows[0]?.n ?? 0, hits: rows.map((r) => ({ id: r.id, title: r.no, subtitle: `${r.account} · ${fdate(r.at)} · ${rp(r.total)}`, href: `/sales/orders/${r.id}` })) };
      },
    },
    {
      type: "products",
      label: "Products",
      href: "/database/products?show=all",
      run: async () => {
        const t = schema.products;
        const rows = await db
          .select({ id: t.id, sku: t.sku, name: t.name, variant: t.variant, price: t.price, active: t.active, total })
          .from(t)
          .where(anyOf(p, t.sku, t.name, t.category))
          .orderBy(t.name)
          .limit(PER_TYPE);
        return { total: rows[0]?.total ?? 0, hits: rows.map((r) => ({ id: r.id, title: `${r.name}${r.variant ? ` · ${r.variant}` : ""}`, subtitle: `${r.sku} · ${rp(r.price)}${r.active ? "" : " · inactive"}`, href: "/database/products?show=all" })) };
      },
    },
    {
      type: "tasks",
      label: "Tasks",
      href: "/sales/tasks",
      run: async () => {
        const t = schema.tasks;
        const rows = await db
          .select({ id: t.id, title: t.title, status: t.status, due: t.dueAt, who: schema.users.name, total })
          .from(t)
          .leftJoin(schema.users, eq(schema.users.id, t.assigneeId))
          .where(and(ownedBy(user, t.assigneeId), anyOf(p, t.title, t.description)))
          .orderBy(desc(t.dueAt))
          .limit(PER_TYPE);
        return { total: rows[0]?.total ?? 0, hits: rows.map((r) => ({ id: r.id, title: r.title, subtitle: [r.who, r.status.replace("_", " "), r.due && `due ${fdate(r.due)}`].filter(Boolean).join(" · "), href: "/sales/tasks" })) };
      },
    },
    {
      type: "campaigns",
      label: "Campaigns",
      href: "/marketing/campaigns",
      run: async () => {
        const t = schema.campaigns;
        const rows = await db.select({ id: t.id, name: t.name, type: t.type, status: t.status, total }).from(t).where(anyOf(p, t.name, t.channel)).orderBy(desc(t.startsOn)).limit(PER_TYPE);
        return { total: rows[0]?.total ?? 0, hits: rows.map((r) => ({ id: r.id, title: r.name, subtitle: [r.type, r.status].filter(Boolean).join(" · "), href: "/marketing/campaigns" })) };
      },
    },
    {
      type: "events",
      label: "Events",
      href: "/event/list",
      run: async () => {
        const t = schema.events;
        const rows = await db.select({ id: t.id, name: t.name, on: t.heldOn, location: t.location, total }).from(t).where(anyOf(p, t.name, t.location)).orderBy(desc(t.heldOn)).limit(PER_TYPE);
        return { total: rows[0]?.total ?? 0, hits: rows.map((r) => ({ id: r.id, title: r.name, subtitle: [fdate(r.on), r.location].filter(Boolean).join(" · "), href: "/event/list" })) };
      },
    },
    // Batch 5: { type: "projects", … } — add here with the projects scope.
  ];

  const allowed = types.filter((t) => {
    const item = findNav(t.href.split("?")[0])?.item;
    return !item || canOpen(item, user.role);
  });
  const results = await Promise.all(allowed.map((t) => t.run()));
  return allowed
    .map((t, i) => ({ type: t.type, label: t.label, href: t.href, total: results[i].total, hits: results[i].hits }))
    .filter((g) => g.hits.length > 0);
}
