import type { Metadata } from "next";
import { asc, count, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { ymd } from "@/lib/format";
import { now } from "@/lib/scope";
import { CONTENT_STEPS, canEditBrief, canTakeStep, isWriter } from "@/lib/content-flow";
import { ContentCalendar, type Post } from "@/components/content/content-calendar";
import { NewBriefButton } from "@/components/content/brief-form";

export const metadata: Metadata = { title: "Content Calendar" };
const HREF = "/marketing/content";
const VIEWS = ["month", "week", "list"] as const;

const wibTime = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false });

export default async function ContentPage({ searchParams }: PageProps<"/marketing/content">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const today = ymd(await now());
  const c = schema.contentItems;
  const db = getDb();

  const [items, files, users, campaigns] = await Promise.all([
    db.select().from(c).orderBy(asc(c.publishAt)),
    db.select({ id: schema.contentAssets.contentId, n: count() }).from(schema.contentAssets).groupBy(schema.contentAssets.contentId),
    db
      .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role, active: schema.users.active })
      .from(schema.users)
      .where(inArray(schema.users.role, ["admin", "marketing", "sales_manager", "designer"]))
      .orderBy(asc(schema.users.name)),
    db.select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).orderBy(asc(schema.campaigns.name)),
  ]);
  const people = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const fileCount = new Map(files.map((f) => [f.id, f.n]));

  const posts: Post[] = items.map((r) => {
    const steps = CONTENT_STEPS[r.status].filter((st) => canTakeStep(st, user.role, user.id, r.designerId));
    return {
      id: r.id,
      title: r.title,
      date: ymd(r.publishAt),
      time: wibTime(r.publishAt),
      status: r.status,
      channels: r.channels,
      format: r.format,
      writer: r.writerId ? (people[r.writerId] ?? null) : null,
      designer: r.designerId ? (people[r.designerId] ?? null) : null,
      keyMessage: r.keyMessage,
      // Designers: posts assigned to them that wait on design. Writers: posts waiting on the writer side.
      myTurn: user.role === "admin" ? false : steps.length > 0 && (user.role === "designer" || r.writerId === user.id || r.writerId === null),
      canMove: canEditBrief(user.role, r.status),
      files: fileCount.get(r.id) ?? 0,
    };
  });
  const options = {
    writers: users.filter((u) => u.active && isWriter(u.role)).map((u) => ({ value: u.id, label: u.name })),
    designers: users.filter((u) => u.active && u.role === "designer").map((u) => ({ value: u.id, label: u.name })),
    campaigns: campaigns.map((x) => ({ value: x.id, label: x.name })),
  };
  const view = VIEWS.includes(params.view as (typeof VIEWS)[number]) ? (params.view as (typeof VIEWS)[number]) : "month";
  const open = typeof params.open === "string" && /^[0-9a-f-]{36}$/i.test(params.open) ? params.open : null;
  const canCreate = isWriter(user.role);

  return (
    <>
      <PageHeader href={HREF} actions={canCreate ? <NewBriefButton options={options} today={today} /> : undefined} />
      <ContentCalendar posts={posts} today={today} canCreate={canCreate} options={options} people={people} initialView={view} initialOpen={open} />
    </>
  );
}
