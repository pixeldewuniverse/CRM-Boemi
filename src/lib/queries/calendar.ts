import "server-only";
import { and, eq, gte, inArray, lt, lte, ne, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import { ftime, ymd } from "@/lib/format";
import { canOpen, findNav } from "@/lib/nav";

export const CAL_TYPES = {
  task: { label: "Tasks", href: "/sales/tasks" },
  visit: { label: "Visits", href: "/sales/visits" },
  event: { label: "Events", href: "/event/list" },
  campaign: { label: "Campaigns", href: "/marketing/campaigns" },
  quote: { label: "Quote deadlines", href: "/sales/quotations" },
  content: { label: "Content", href: "/marketing/content" },
} as const;
export type CalType = keyof typeof CAL_TYPES;
export type CalWho = "me" | "team" | "all";

export type CalendarItem = {
  key: string;
  type: CalType;
  day: string; // YYYY-MM-DD (Jakarta)
  time: string | null; // HH:mm, null = all day
  title: string;
  sub?: string;
  href: string;
  done?: boolean;
};

/** Which "who" filters a role may use. Sales and other roles: only their own items. */
export function whoOptions(user: CurrentUser): CalWho[] {
  if (user.role === "admin" || user.role === "executive") return ["me", "all"];
  if (user.role === "sales_manager") return ["me", "team"];
  return ["me"];
}

/** Types the role may open (same menu rules as everywhere else). */
export function allowedTypes(user: CurrentUser): CalType[] {
  return (Object.keys(CAL_TYPES) as CalType[]).filter((t) => {
    const item = findNav(CAL_TYPES[t].href)?.item;
    return !item || canOpen(item, user.role);
  });
}

const jkt = (d: string, time = "00:00") => new Date(`${d}T${time}:00+07:00`);

/**
 * Everything dated between `from` and `to` (inclusive, YYYY-MM-DD) for the
 * people in scope. "who" is re-checked here, so a sales rep can never ask for
 * the team or everyone.
 */
export async function calendarItems(user: CurrentUser, opts: { from: string; to: string; who: CalWho; types: CalType[] }): Promise<CalendarItem[]> {
  const db = getDb();
  const who = whoOptions(user).includes(opts.who) ? opts.who : "me";
  let people: string[] | null = [user.id];
  if (who === "team") {
    const team = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.managerId, user.id));
    people = [user.id, ...team.map((t) => t.id)];
  } else if (who === "all") people = null;
  const mine = (...cols: AnyPgColumn[]): SQL | undefined => (people ? or(...cols.map((c) => inArray(c, people!))) : undefined);

  const types = opts.types.filter((t) => allowedTypes(user).includes(t));
  const start = jkt(opts.from);
  const end = jkt(opts.to, "23:59");
  const out: CalendarItem[] = [];
  const at = (d: Date) => ({ day: ymd(d), time: ftime(d) });

  await Promise.all(
    types.map(async (type) => {
      switch (type) {
        case "task": {
          const t = schema.tasks;
          const rows = await db
            .select({ id: t.id, title: t.title, due: t.dueAt, status: t.status, who: schema.users.name, account: schema.customers.name })
            .from(t)
            .leftJoin(schema.users, eq(schema.users.id, t.assigneeId))
            .leftJoin(schema.customers, eq(schema.customers.id, t.customerId))
            .where(and(mine(t.assigneeId), gte(t.dueAt, start), lte(t.dueAt, end)));
          for (const r of rows) out.push({ key: `t${r.id}`, type, ...at(r.due!), title: r.title, sub: [r.account, who !== "me" ? r.who : null].filter(Boolean).join(" · "), href: "/sales/tasks", done: r.status === "done" });
          break;
        }
        case "visit": {
          const v = schema.visits;
          const rows = await db
            .select({ id: v.id, at: v.scheduledAt, purpose: v.purpose, accountId: schema.customers.id, account: schema.customers.name, who: schema.users.name })
            .from(v)
            .innerJoin(schema.customers, eq(schema.customers.id, v.customerId))
            .leftJoin(schema.users, eq(schema.users.id, v.salesId))
            .where(and(mine(v.salesId), eq(v.status, "planned"), gte(v.scheduledAt, start), lte(v.scheduledAt, end)));
          for (const r of rows) out.push({ key: `v${r.id}`, type, ...at(r.at!), title: `Visit: ${r.account}`, sub: [r.purpose, who !== "me" ? r.who : null].filter(Boolean).join(" · "), href: `/database/accounts/${r.accountId}` });
          break;
        }
        case "event": {
          const e = schema.events;
          const rows = await db.select({ id: e.id, name: e.name, on: e.heldOn, location: e.location, status: e.status }).from(e).where(and(mine(e.ownerId), gte(e.heldOn, opts.from), lte(e.heldOn, opts.to), ne(e.status, "cancelled")));
          for (const r of rows) out.push({ key: `e${r.id}`, type, day: r.on, time: null, title: r.name, sub: r.location ?? undefined, href: "/event/list", done: r.status === "done" });
          break;
        }
        case "campaign": {
          const c = schema.campaigns;
          const rows = await db
            .select({ id: c.id, name: c.name, starts: c.startsOn, ends: c.endsOn })
            .from(c)
            .where(and(mine(c.ownerId), or(and(gte(c.startsOn, opts.from), lte(c.startsOn, opts.to)), and(gte(c.endsOn, opts.from), lte(c.endsOn, opts.to)))));
          for (const r of rows) {
            if (r.starts && r.starts >= opts.from && r.starts <= opts.to) out.push({ key: `cs${r.id}`, type, day: r.starts, time: null, title: `▶ ${r.name}`, sub: "Campaign starts", href: "/marketing/campaigns" });
            if (r.ends && r.ends >= opts.from && r.ends <= opts.to && r.ends !== r.starts) out.push({ key: `ce${r.id}`, type, day: r.ends, time: null, title: `■ ${r.name}`, sub: "Campaign ends", href: "/marketing/campaigns" });
          }
          break;
        }
        case "quote": {
          const q = schema.quotations;
          const rows = await db
            .select({ id: q.id, no: q.quoteNo, valid: q.validUntil, account: schema.customers.name })
            .from(q)
            .innerJoin(schema.customers, eq(schema.customers.id, q.customerId))
            .where(and(mine(q.ownerId), eq(q.status, "sent"), gte(q.validUntil, opts.from), lte(q.validUntil, opts.to)));
          for (const r of rows) out.push({ key: `q${r.id}`, type, day: r.valid!, time: null, title: `${r.no} expires`, sub: r.account, href: `/sales/quotations/${r.id}` });
          break;
        }
        case "content": {
          const k = schema.contentItems;
          const rows = await db
            .select({ id: k.id, title: k.title, at: k.publishAt, status: k.status, format: k.format })
            .from(k)
            .where(and(mine(k.writerId, k.designerId), gte(k.publishAt, start), lt(k.publishAt, end)));
          for (const r of rows) out.push({ key: `k${r.id}`, type, ...at(r.at), title: r.title, sub: r.format ?? undefined, href: "/marketing/content", done: r.status === "published" });
          break;
        }
      }
    }),
  );
  return out.sort((a, b) => (a.day + (a.time ?? "00:00") + a.title).localeCompare(b.day + (b.time ?? "00:00") + b.title));
}
