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
import { EditCriterionButton, NewCriterionButton, QualificationSettingsForm, RescoreAllButton } from "@/components/forms/qualification-forms";
import { OPERATORS } from "@/lib/qualification/fields";
import { aiConfig } from "@/lib/qualification/providers";

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
  const [probabilities, qualification] = await Promise.all([getSetting("pipeline"), getSetting("qualification")]);
  const ai = aiConfig();
  const criteria = await getDb().select().from(schema.qualificationCriteria).orderBy(asc(schema.qualificationCriteria.createdAt));
  const totalWeight = criteria.filter((c) => c.active).reduce((s, c) => s + c.weight, 0);

  return (
    <>
      <PageHeader href={HREF} />
      <Panel
        title="Lead qualification criteria"
        description={`Rules are checked by code; AI criteria are judged from notes (0–3, with a quote). The final score (0–100) is always computed by code: earned weight ÷ weight that applies. Active weights total ${totalWeight}.`}
        actions={
          <>
            <RescoreAllButton />
            <NewCriterionButton />
          </>
        }
        flush
      >
        <p className={`border-b border-line px-4 py-2 text-[13px] ${ai.on ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted"}`}>
          AI layer: {ai.on ? `on · ${ai.provider === "mock" ? "demo provider (simulated, no network)" : `${ai.provider} · ${ai.model}`}` : "off — rules only (set QUALIFICATION_AI=on)"}. Only segment, city, source, consent, safe interests and redacted notes are sent; never names, phone numbers or e-mails.
        </p>
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th>Criterion</th>
              <th>Checked by</th>
              <th>Rule</th>
              <th className="num">Weight</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {criteria.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">
                  {c.name}
                  {c.description && <p className="max-w-md whitespace-pre-line text-xs font-normal text-muted">{c.description}</p>}
                </td>
                <td>{c.kind === "ai" ? <Pill tone="info">AI</Pill> : <Pill>Rule</Pill>}</td>
                <td className="text-[13px]">
                  {c.kind === "ai" ? (
                    <span className="text-muted">Reads notes, visits, activities</span>
                  ) : (
                    <>
                      <span className="font-mono text-xs">{c.field}</span> {OPERATORS[c.operator]} {c.operator === "exists" ? "" : Array.isArray(c.value) ? (c.value as unknown[]).join(", ") : String(c.value)}
                    </>
                  )}
                </td>
                <td className="num">{c.weight}</td>
                <td>{c.active ? <Pill tone="ok">Active</Pill> : <Pill>Off</Pill>}</td>
                <td>
                  <EditCriterionButton c={{ id: c.id, name: c.name, kind: c.kind, field: c.field, operator: c.operator, value: c.value, weight: c.weight, description: c.description, active: c.active }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Tiers & contact SLA" description="Tier from the score; SLA = days within which a lead of that tier must be contacted (Contact Today, reminders).">
        <QualificationSettingsForm v={qualification} />
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
