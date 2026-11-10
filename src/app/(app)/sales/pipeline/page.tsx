import Link from "next/link";
import { isManager } from "@/lib/permissions";
import type { Metadata } from "next";
import { and, asc, eq, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { effectiveProbability, stageProbabilities } from "@/lib/reports/forecast";
import { NewDealButton } from "@/components/forms/sales-forms";
import { canSell } from "@/lib/permissions";
import { accountOptions, repOptions } from "@/lib/queries/options";
import { PipelineBoard } from "@/components/board/pipeline-board";
import { pct, rpk, ymd } from "@/lib/format";
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
        .where(and(inArray(schema.users.role, ["sales", "sales_manager", "staff"]), eq(schema.users.active, true), ownedBy(user, schema.users.id)))
        .orderBy(asc(schema.users.name))
    : [];
  const owner = reps.some((r) => r.id === params.owner) ? (params.owner as string) : undefined;

  const deals = await db
    .select({
      id: o.id,
      title: o.title,
      stage: o.stage,
      value: o.value,
      probability: o.probability,
      probabilityOverride: o.probabilityOverride,
      close: o.expectedCloseOn,
      lostReason: o.lostReason,
      ownerId: o.ownerId,
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
  const probs = await stageProbabilities();
  const weighted = open.reduce((s, d) => s + ((d.value ?? 0) * effectiveProbability(d, probs)) / 100, 0);
  const won = deals.filter((d) => d.stage === "won").length;
  const lost = deals.filter((d) => d.stage === "lost").length;

  return (
    <>
      <PageHeader href={HREF} actions={canSell(user) ? <NewDealButton accounts={await accountOptions(user)} reps={await repOptions(user)} /> : undefined} />
      <Stats
        items={[
          { label: "Open pipeline", value: rpk(openValue), hint: `${open.length} open deals` },
          { label: "Weighted forecast", value: rpk(weighted), hint: <Link href="/sales/forecast" className="hover:text-accent">Value × probability · see forecast →</Link> },
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
      <PipelineBoard
        today={ymd(today)}
        probabilities={probs}
        deals={deals.map((d) => ({
          id: d.id,
          title: d.title,
          column: d.stage,
          movable: d.ownerId === user.id || isManager(user),
          value: d.value ?? 0,
          close: d.close,
          account: d.account,
          accountId: d.accountId,
          owner: d.owner ?? "—",
          lostReason: d.lostReason,
        }))}
      />
    </>
  );
}
