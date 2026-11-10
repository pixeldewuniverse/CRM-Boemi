import type { Metadata } from "next";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { MarkContactedButton } from "@/components/qualification/contact-button";
import { ScoreButton } from "@/components/qualification/score-panel";
import { TierBadge } from "@/components/tier-badge";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { fphone } from "@/lib/format";
import { contactQueue, endOfDay } from "@/lib/qualification/contact";
import { now } from "@/lib/scope";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Contact Today" };
const HREF = "/sales/contact-today";
const VIEWS = { due: "Due now", all: "All open leads" } as const;

/** Calendar days in Jakarta between today and the due moment. */
const jakartaDay = (d: Date) => Math.floor((d.getTime() + 7 * 3_600_000) / 86_400_000);
const dueLabel = (due: Date, overdue: boolean, today: Date) => {
  const days = jakartaDay(due) - jakartaDay(today);
  if (overdue) return days === 0 ? "SLA passed today" : `${-days} day${days === -1 ? "" : "s"} past SLA`;
  if (days <= 0) return "Due today";
  return days === 1 ? "Due tomorrow" : `Due in ${days} days`;
};
const wa = (phone: string | null) => (phone ? `https://wa.me/${phone.replace(/^\+/, "")}` : null);

export default async function ContactTodayPage({ searchParams }: PageProps<"/sales/contact-today">) {
  const { user, denied } = await guard(HREF);
  if (denied) return denied;
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "due";
  const today = await now();
  const [queue, sla] = await Promise.all([contactQueue(user, today), getSetting("qualification")]);
  const horizon = endOfDay(today);
  const due = queue.filter((q) => q.overdue || q.due <= horizon);
  const list = view === "all" ? queue : due;

  return (
    <>
      <PageHeader href={HREF} />
      <Stats
        items={[
          { label: "Past SLA", value: queue.filter((q) => q.overdue).length, tone: queue.some((q) => q.overdue) ? "bad" : "ok", hint: `Hot ${sla.slaHot}d · Warm ${sla.slaWarm}d · Cold ${sla.slaCold}d` },
          { label: "Due today", value: due.length - queue.filter((q) => q.overdue).length },
          { label: "Never contacted", value: queue.filter((q) => q.firstContact).length },
          { label: "Open leads", value: queue.length, hint: "New + contacted, all included" },
        ]}
      />
      <FilterChips pathname={HREF} param="view" value={view === "all" ? "all" : undefined} options={[{ value: undefined, label: VIEWS.due, count: due.length }, { value: "all", label: VIEWS.all, count: queue.length }]} />
      <Panel title={view === "all" ? "All open leads, in contact order" : "Contact these first"} description="Order = score + 2 points for each day waiting (max 30) + 20 once the SLA has passed. Unscored leads count as 0 and still appear." flush>
        {list.length === 0 ? (
          <Empty>{view === "all" ? "No open leads." : "Nothing due — everyone has been contacted within their SLA."}</Empty>
        ) : (
          <ol className="divide-y divide-line">
            {list.map((q, i) => (
              <li key={q.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                <span className="w-6 flex-none pt-0.5 text-right text-xs font-bold tabular-nums text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-semibold">{q.company}</p>
                  <p className="text-xs text-muted">
                    {[q.pic, q.segment, q.city, q.source].filter(Boolean).join(" · ")}
                    {q.owner ? ` · ${q.owner}` : " · unassigned"}
                  </p>
                  {q.reason && <p className="mt-0.5 text-xs text-muted">{q.reason}</p>}
                </div>
                <div className="w-36 flex-none">
                  <ScoreButton type="lead" id={q.id} score={q.score}>
                    <span className="font-semibold tabular-nums">{q.score ?? "—"}</span>
                    <TierBadge tier={q.tier} />
                  </ScoreButton>
                  <p className="mt-0.5 text-xs tabular-nums text-muted" title="Score + waiting boost + SLA boost">
                    priority {q.priority}
                  </p>
                </div>
                <div className="w-40 flex-none text-xs">
                  <p className={q.overdue ? "font-semibold text-bad" : "text-muted"}>{dueLabel(q.due, q.overdue, today)}</p>
                  <p className="text-muted">
                    {q.firstContact ? "Never contacted" : "Last contact"} · waiting {q.days} day{q.days === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-none flex-wrap items-center gap-1.5">
                  {q.phone && (
                    <>
                      <a href={`tel:${q.phone}`} className="btn px-2.5 py-1 text-xs" aria-label={`Call ${q.company}`}>
                        {fphone(q.phone)}
                      </a>
                      <a href={wa(q.phone)!} target="_blank" rel="noopener noreferrer" className="btn px-2.5 py-1 text-xs">
                        WhatsApp
                      </a>
                    </>
                  )}
                  {!q.phone && q.email && (
                    <a href={`mailto:${q.email}`} className="btn px-2.5 py-1 text-xs">
                      Email
                    </a>
                  )}
                  <MarkContactedButton leadId={q.id} company={q.company} again={!q.firstContact} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );
}
