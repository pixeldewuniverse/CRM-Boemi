import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { ftime, ymd } from "@/lib/format";
import { CONTENT_FLOW, CONTENT_STATUS } from "@/lib/labels";
import { now } from "@/lib/scope";

export const metadata: Metadata = { title: "Content Calendar" };
const HREF = "/marketing/content";
type Status = (typeof CONTENT_FLOW)[number];

export default async function ContentPage({ searchParams }: PageProps<"/marketing/content">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const status = CONTENT_FLOW.includes(params.status as Status) ? (params.status as Status) : undefined;
  const today = ymd(await now());
  const c = schema.contentItems;
  const designer = alias(schema.users, "designer");

  const all = await getDb()
    .select({
      id: c.id,
      title: c.title,
      at: c.publishAt,
      channels: c.channels,
      format: c.format,
      status: c.status,
      objective: c.objective,
      keyMessage: c.keyMessage,
      cta: c.cta,
      products: c.products,
      writer: schema.users.name,
      writerId: c.writerId,
      designer: designer.name,
      designerId: c.designerId,
    })
    .from(c)
    .leftJoin(schema.users, eq(schema.users.id, c.writerId))
    .leftJoin(designer, eq(designer.id, c.designerId))
    .orderBy(asc(c.publishAt));

  const rows = status ? all.filter((r) => r.status === status) : all;
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = ymd(r.at);
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }
  const myTurn = (r: (typeof all)[number]) =>
    (user.role === "designer" && r.designerId === user.id && ["ready_for_design", "in_design", "revision"].includes(r.status)) ||
    (user.role === "marketing" && r.writerId === user.id && ["draft_brief", "in_review"].includes(r.status));

  return (
    <>
      <PageHeader href={HREF} />
      <FilterChips
        pathname={HREF}
        param="status"
        value={status}
        options={[
          { value: undefined, label: "All", count: all.length },
          ...CONTENT_FLOW.map((s) => ({ value: s, label: CONTENT_STATUS[s].label, count: all.filter((r) => r.status === s).length })),
        ]}
      />
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No content in this status.</Empty>
        ) : (
          <ol className="divide-y divide-line">
            {[...byDay.entries()].map(([day, items]) => {
              const d = new Date(`${day}T00:00:00+07:00`);
              const isToday = day === today;
              return (
                <li key={day} className="grid gap-3 px-4 py-3 sm:grid-cols-[6.5rem_1fr]">
                  <div className={isToday ? "text-accent" : day < today ? "text-muted" : ""}>
                    <p className="text-xs font-semibold uppercase tracking-wide">
                      {d.toLocaleDateString("en-GB", { timeZone: "Asia/Jakarta", weekday: "short" })}
                      {isToday && " · today"}
                    </p>
                    <p className="text-lg font-bold leading-tight">
                      {d.toLocaleDateString("en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.map((r) => (
                      <article key={r.id} className={`rounded-lg border p-3 ${myTurn(r) ? "border-accent" : "border-line"}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs tabular-nums text-muted">{ftime(r.at)}</span>
                          <span className="text-xs font-semibold">{r.channels.join(" · ")}</span>
                          <span className="text-xs text-muted">{r.format}</span>
                          <span className="ml-auto">
                            <StatusPill map={CONTENT_STATUS} value={r.status} />
                          </span>
                        </div>
                        <p className="mt-1 font-semibold">{r.title}</p>
                        <p className="text-[13px] text-muted">
                          {r.objective} — <span className="text-fg">{r.keyMessage}</span>
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          Writer {r.writer ?? "—"} · Designer {r.designer ?? "—"}
                          {r.products ? ` · ${r.products}` : ""}
                          {myTurn(r) && <span className="ml-1 font-semibold text-accent">· your turn</span>}
                        </p>
                      </article>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </>
  );
}
