import type { Metadata } from "next";
import Link from "next/link";
import { DayAddButton } from "@/components/calendar-day-add";
import { NewTaskButton } from "@/components/forms/sales-forms";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { getCurrentUser } from "@/lib/auth";
import { monthLabel, ymd } from "@/lib/format";
import { canSell } from "@/lib/permissions";
import { allowedTypes, CAL_TYPES, calendarItems, whoOptions, type CalType, type CalWho, type CalendarItem } from "@/lib/queries/calendar";
import { accountOptions, repOptions } from "@/lib/queries/options";
import { now } from "@/lib/scope";

export const metadata: Metadata = { title: "Calendar" };
const HREF = "/calendar";
const VIEWS = ["month", "week", "agenda"] as const;
type View = (typeof VIEWS)[number];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOT: Record<CalType, string> = { task: "bg-c1", visit: "bg-c2", event: "bg-c3", campaign: "bg-c4", quote: "bg-warn", content: "bg-info" };
const WHO_LABEL: Record<CalWho, string> = { me: "Me", team: "My team", all: "Everyone" };
const TASK_DIALOG = "calendar-new-task";

/* Date math on YYYY-MM-DD strings (calendar days, no time zone involved). */
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
const startOfWeek = (d: string) => addDays(d, -dow(d));
const lastOfMonth = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).toISOString().slice(0, 10);
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const today = ymd(await now());
  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : "month";
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && !Number.isNaN(Date.parse(params.date)) ? params.date : today;
  const whos = whoOptions(user);
  const who: CalWho = whos.includes(params.who as CalWho) ? (params.who as CalWho) : "me";
  const allowed = allowedTypes(user);
  const picked = typeof params.types === "string" ? (params.types.split(",").filter((t) => allowed.includes(t as CalType)) as CalType[]) : allowed;
  const types = picked.length ? picked : allowed;

  const monthStart = `${date.slice(0, 7)}-01`;
  const monthEnd = lastOfMonth(date);
  const [from, to] = view === "week" ? [startOfWeek(date), addDays(startOfWeek(date), 6)] : [startOfWeek(monthStart), addDays(startOfWeek(lastOfMonth(date)), 6)];
  const canAdd = canSell(user) || user.role === "marketing";
  const [items, accounts, reps] = await Promise.all([
    calendarItems(user, { from, to, who, types }),
    canAdd ? accountOptions(user) : Promise.resolve([]),
    canAdd ? repOptions(user) : Promise.resolve([]),
  ]);
  const byDay = new Map<string, CalendarItem[]>();
  for (const it of items) byDay.set(it.day, [...(byDay.get(it.day) ?? []), it]);
  const days = Array.from({ length: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 }, (_, i) => addDays(from, i));

  const keep = { view, date, who: who === "me" ? undefined : who, types: types.length === allowed.length ? undefined : types.join(",") };
  const link = (patch: Record<string, string | undefined>) => ({ pathname: HREF, query: Object.fromEntries(Object.entries({ ...keep, ...patch }).filter(([, v]) => v)) as Record<string, string> });
  const step = view === "week" ? 7 : 0;
  const prevDate = step ? addDays(date, -7) : addDays(monthStart, -1).slice(0, 8) + "01";
  const nextDate = step ? addDays(date, 7) : addDays(monthEnd, 1);
  const title = view === "week" ? `${dayLabel(from, { day: "numeric", month: "short" })} – ${dayLabel(to, { day: "numeric", month: "short", year: "numeric" })}` : monthLabel(date.slice(0, 7));
  const toggleType = (t: CalType) => {
    const next = types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
    return link({ types: next.length === allowed.length || next.length === 0 ? undefined : next.join(",") });
  };

  const chip = (it: CalendarItem) => (
    <Link key={it.key} href={it.href} className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs hover:bg-surface-2 ${it.done ? "text-muted line-through" : ""}`} title={[it.time, it.title, it.sub].filter(Boolean).join(" · ")}>
      <span className={`size-2 flex-none rounded-full ${DOT[it.type]}`} aria-hidden="true" />
      {it.time && <span className="flex-none tabular-nums text-muted">{it.time}</span>}
      <span className="truncate">{it.title}</span>
      <span className="sr-only">({CAL_TYPES[it.type].label})</span>
    </Link>
  );
  const agenda = (list: string[], className = "") => {
    const withItems = list.filter((d) => byDay.has(d) || d === today);
    return (
      <ol className={`panel divide-y divide-line ${className}`} aria-label="Agenda">
        {withItems.length === 0 && <li className="px-4 py-8 text-center text-muted">Nothing scheduled.</li>}
        {withItems.map((d) => (
          <li key={d} className="flex gap-3 px-4 py-3">
            <div className={`w-14 flex-none text-center ${d === today ? "text-accent" : ""}`}>
              <p className="text-xs uppercase text-muted">{dayLabel(d, { weekday: "short" })}</p>
              <p className="text-xl font-bold leading-tight">{Number(d.slice(8))}</p>
              <p className="text-xs text-muted">{dayLabel(d, { month: "short" })}</p>
            </div>
            <ul className="min-w-0 flex-1">
              {(byDay.get(d) ?? []).map((it) => (
                <li key={it.key}>
                  <Link href={it.href} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2 ${it.done ? "text-muted line-through" : ""}`}>
                    <span className={`mt-1.5 size-2 flex-none rounded-full ${DOT[it.type]}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold">
                        {it.time && <span className="mr-1.5 tabular-nums text-muted">{it.time}</span>}
                        {it.title}
                      </span>
                      <span className="block text-xs text-muted">{[CAL_TYPES[it.type].label.replace(/s$/, ""), it.sub].filter(Boolean).join(" · ")}</span>
                    </span>
                  </Link>
                </li>
              ))}
              {!byDay.has(d) && <li className="px-2 py-1.5 text-[13px] text-muted">Nothing scheduled today.</li>}
            </ul>
            {canAdd && <DayAddButton date={d} dialogId={TASK_DIALOG} label={`Add task on ${dayLabel(d, { day: "numeric", month: "long" })}`} />}
          </li>
        ))}
      </ol>
    );
  };

  return (
    <>
      <PageHeader href={HREF} actions={canAdd && <NewTaskButton accounts={accounts} reps={reps} dialogId={TASK_DIALOG} />} />

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Period" className="flex items-center gap-1.5">
          <Link href={link({ date: prevDate })} className="btn" aria-label={view === "week" ? "Previous week" : "Previous month"}>
            ←
          </Link>
          <Link href={link({ date: today })} className="btn">
            Today
          </Link>
          <Link href={link({ date: nextDate })} className="btn" aria-label={view === "week" ? "Next week" : "Next month"}>
            →
          </Link>
        </nav>
        <h2 className="mr-auto text-lg font-bold">{title}</h2>
        <FilterChips pathname={HREF} param="view" value={view === "month" ? undefined : view} keep={{ ...keep, view: undefined }} options={[{ value: undefined, label: "Month" }, { value: "week", label: "Week" }, { value: "agenda", label: "Agenda" }]} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {whos.length > 1 && <FilterChips pathname={HREF} param="who" value={who === "me" ? undefined : who} keep={{ ...keep, who: undefined }} options={whos.map((w) => ({ value: w === "me" ? undefined : w, label: WHO_LABEL[w] }))} />}
        <ul className="flex flex-wrap gap-1.5" aria-label="Show types">
          {allowed.map((t) => {
            const on = types.includes(t);
            return (
              <li key={t}>
                <Link href={toggleType(t)} aria-pressed={on} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${on ? "border-line bg-surface text-fg" : "border-dashed border-line text-muted line-through"}`}>
                  <span className={`size-2 rounded-full ${DOT[t]}`} aria-hidden="true" />
                  {CAL_TYPES[t].label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {view === "agenda" && agenda(days.filter((d) => d >= monthStart && d <= monthEnd))}

      {view === "month" && (
        <>
          <section aria-label={monthLabel(date.slice(0, 7))} className="panel hidden overflow-hidden md:block">
            <div className="grid grid-cols-7 border-b border-line text-xs font-semibold text-muted">
              {DOW.map((d) => (
                <div key={d} className="px-2 py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const list = byDay.get(d) ?? [];
                const out = d < monthStart || d > monthEnd;
                return (
                  <div key={d} className={`group flex min-h-28 min-w-0 flex-col gap-0.5 border-b border-r border-line p-1 [&:nth-child(7n)]:border-r-0 ${out ? "bg-surface-2/40" : ""}`}>
                    <div className="flex items-center justify-between px-1">
                      <span className={`text-xs font-semibold ${d === today ? "grid size-6 place-items-center rounded-full bg-accent text-accent-ink" : out ? "text-muted" : ""}`}>{Number(d.slice(8))}</span>
                      {canAdd && <DayAddButton date={d} dialogId={TASK_DIALOG} label={`Add task on ${dayLabel(d, { day: "numeric", month: "long" })}`} />}
                    </div>
                    {list.slice(0, 3).map(chip)}
                    {list.length > 3 && (
                      <Link href={link({ view: "week", date: d })} className="px-1.5 text-xs font-semibold text-accent hover:underline">
                        +{list.length - 3} more
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          {agenda(days.filter((d) => d >= monthStart && d <= monthEnd), "md:hidden")}
        </>
      )}

      {view === "week" && (
        <section aria-label={title} className="panel grid overflow-hidden md:grid-cols-7">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={d} className="flex min-w-0 flex-col gap-1 border-b border-line p-2 md:min-h-80 md:border-b-0 md:border-r md:[&:nth-child(7n)]:border-r-0">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-[13px] font-semibold ${d === today ? "text-accent" : ""}`}>
                    {dayLabel(d, { weekday: "short" })} <span className="tabular-nums">{Number(d.slice(8))}</span>
                  </p>
                  {canAdd && <DayAddButton date={d} dialogId={TASK_DIALOG} label={`Add task on ${dayLabel(d, { day: "numeric", month: "long" })}`} />}
                </div>
                {list.length === 0 && <p className="text-xs text-muted md:hidden">—</p>}
                {list.map((it) => (
                  <Link key={it.key} href={it.href} className={`rounded-lg border border-line px-2 py-1.5 hover:border-muted ${it.done ? "text-muted line-through" : ""}`}>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      <span className={`size-2 rounded-full ${DOT[it.type]}`} aria-hidden="true" />
                      {it.time ?? "All day"}
                    </span>
                    <span className="block text-[13px] font-semibold leading-snug">{it.title}</span>
                    {it.sub && <span className="block truncate text-xs text-muted">{it.sub}</span>}
                  </Link>
                ))}
              </div>
            );
          })}
        </section>
      )}
      <p className="text-xs text-muted">Sync with Google Calendar comes once BOEMI&apos;s Google Workspace is connected.</p>
    </>
  );
}
