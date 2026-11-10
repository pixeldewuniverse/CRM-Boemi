import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { ACTIVITY_TYPES, LEAD_SOURCES, LOST_REASONS, SEGMENTS, STAGE, STAGES } from "@/lib/labels";
import { PRICE_TIERS, SEGMENT_TIER } from "@/lib/pricing";
import { getSetting } from "@/lib/settings";
import { StageProbabilityForm } from "@/components/forms/settings-forms";

export const metadata: Metadata = { title: "Master Data" };
const HREF = "/settings/master-data";

function List({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <Panel title={title}>
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i} className="rounded-lg border border-line px-2.5 py-1 text-[13px]">
            {i}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default async function MasterDataPage() {
  const { denied } = await guard(HREF);
  if (denied) return denied;
  const probabilities = await getSetting("pipeline");
  const criteria = await getDb().select().from(schema.qualificationCriteria).orderBy(asc(schema.qualificationCriteria.createdAt));
  const totalWeight = criteria.filter((c) => c.active).reduce((s, c) => s + c.weight, 0);

  return (
    <>
      <PageHeader href={HREF} />
      <Panel
        title="Lead qualification criteria"
        description={`Client-defined rules used to score leads and accounts (0–100). Active weights total ${totalWeight}. The AI reviews visit notes on top of these rules and explains the score.`}
        flush
      >
        <table className="tbl min-w-[640px]">
          <thead>
            <tr>
              <th>Criterion</th>
              <th>Field</th>
              <th>Rule</th>
              <th className="num">Weight</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {criteria.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">{c.name}</td>
                <td className="font-mono text-xs">{c.field}</td>
                <td>
                  {c.operator.replace("_", " ")} {Array.isArray(c.value) ? (c.value as unknown[]).join(", ") : String(c.value)}
                </td>
                <td className="num">{c.weight}</td>
                <td>{c.active ? <Pill tone="ok">Active</Pill> : <Pill>Off</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Segments & price tier" flush>
          <table className="tbl">
            <tbody>
              {SEGMENTS.map((s) => (
                <tr key={s}>
                  <td className="font-semibold">{s}</td>
                  <td>{PRICE_TIERS[SEGMENT_TIER[s]].label}</td>
                  <td className="num">{Math.round(PRICE_TIERS[SEGMENT_TIER[s]].factor * 100)}% of retail</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Deal stages · win probability" description="Used for the weighted pipeline and the Sales Forecast. Changes apply to every open deal that doesn't have its own probability.">
          <StageProbabilityForm v={probabilities} stages={STAGES.filter((s) => s !== "won" && s !== "lost").map((s) => ({ key: s, label: STAGE[s].label }))} />
        </Panel>
        <List title="Lead sources" items={LEAD_SOURCES} />
        <List title="Lost reasons" items={LOST_REASONS} />
        <List title="Activity types" items={ACTIVITY_TYPES} />
      </div>
    </>
  );
}
