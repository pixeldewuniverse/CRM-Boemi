import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { daysBetween, fday, pct, rpk } from "@/lib/format";
import { STAGE, STAGES } from "@/lib/labels";
import { now, ownedBy, seesAll } from "@/lib/scope";

export const metadata: Metadata = { title: "Pipeline" };
const HREF = "/sales/pipeline";

export default async function PipelinePage({ searchParams }: PageProps<"/sales/pipeline">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const today = await now();
  const db = getDb();
  const o = schema.opportunities;

  const reps = seesAll(user)
    ? await db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(and(inArray(schema.users.role, ["sales", "sales_manager"]), eq(schema.users.active, true)))
        .orderBy(asc(schema.users.name))
    : [];
  const owner = reps.some((r) => r.id === params.owner) ? (params.owner as string) : undefined;

  const deals = await db
    .select({
      id: o.id,
      title: o.title,
      stage: o.stage,
      value: o.value,
      close: o.expectedCloseOn,
      lostReason: o.lostReason,
      accountId: schema.customers.id,
      account: schema.customers.name,
      owner: schema.users.name,
    })
    .from(o)
    .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
    .leftJoin(schema.users, eq(schema.users.id, o.ownerId))
    .where(and(ownedBy(user, o.ownerId), owner ? eq(o.ownerId, owner) : undefined))
    .orderBy(asc(o.expectedCloseOn));

  const open = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const openValue = open.reduce((s, d) => s + (d.value ?? 0), 0);
  const weighted = open.reduce((s, d) => s + ((d.value ?? 0) * STAGE[d.stage].probability) / 100, 0);
  const won = deals.filter((d) => d.stage === "won").length;
  const lost = deals.filter((d) => d.stage === "lost").length;

  return (
    <>
      <PageHeader href={HREF} />
      <Stats
        items={[
          { label: "Open pipeline", value: rpk(openValue), hint: `${open.length} open deals` },
          { label: "Weighted forecast", value: rpk(weighted), hint: "Value × stage probability" },
          { label: "Won", value: won, tone: "ok" },
          { label: "Win rate", value: pct(won + lost ? (won / (won + lost)) * 100 : null), hint: `${won} won · ${lost} lost` },
        ]}
      />
      {reps.length > 0 && (
        <FilterChips
          pathname={HREF}
          param="owner"
          value={owner}
          options={[{ value: undefined, label: "Everyone" }, ...reps.map((r) => ({ value: r.id, label: r.name }))]}
        />
      )}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
        <div className="grid min-w-[1260px] grid-cols-7 gap-3">
          {STAGES.map((stage) => {
            const cards = deals.filter((d) => d.stage === stage);
            const sum = cards.reduce((s, d) => s + (d.value ?? 0), 0);
            return (
              <section key={stage} className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface-2/60 p-2">
                <header className="flex items-baseline justify-between gap-2 px-1 pt-1">
                  <h2 className="truncate text-[13px] font-bold">{STAGE[stage].label}</h2>
                  <span className="text-xs tabular-nums text-muted">{cards.length}</span>
                </header>
                <p className="px-1 text-xs tabular-nums text-muted">
                  {rpk(sum)} · {STAGE[stage].probability}%
                </p>
                {cards.map((d) => {
                  const days = d.close ? daysBetween(today, d.close) : null;
                  const late = days !== null && days < 0 && stage !== "won" && stage !== "lost";
                  return (
                    <article key={d.id} className="panel flex flex-col gap-1 p-3 text-[13px]">
                      <p className="font-semibold leading-snug">{d.title}</p>
                      <Link href={`/database/accounts/${d.accountId}`} className="truncate text-xs text-muted hover:text-accent">
                        {d.account}
                      </Link>
                      <p className="font-bold tabular-nums">{rpk(d.value)}</p>
                      <p className="flex justify-between gap-2 text-xs text-muted">
                        <span className="truncate">{d.owner}</span>
                        <span className={late ? "font-semibold text-bad" : ""}>{fday(d.close)}</span>
                      </p>
                      {d.lostReason && <p className="text-xs text-bad">{d.lostReason}</p>}
                    </article>
                  );
                })}
                {cards.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted">No deals</p>}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
