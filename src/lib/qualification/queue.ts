import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb, schema } from "@/db";
import { getSetting } from "@/lib/settings";
import { qualify, type Db, type SubjectType } from "./engine";
import { getAi } from "./providers";

const MAX_ATTEMPTS = 3;
/** AI failed but rules were saved: try the AI again later (once or twice). */
const AI_RETRY_MIN = 30;

async function thresholds() {
  const s = await getSetting("qualification");
  return { hotAt: s.hotAt, warmAt: s.warmAt };
}

/** Score right now (manual "Re-score"). */
export async function qualifyNow(type: SubjectType, id: string, trigger: string, actorId: string | null) {
  return qualify(getDb() as unknown as Db, type, id, { trigger, actorId, ai: getAi(), thresholds: await thresholds() });
}

/**
 * Queue a (re-)score without blocking the request: the job is stored, then
 * processed after the response is sent (after()); the cron job
 * `qualification-queue` picks up anything left (e.g. after a restart).
 */
export async function enqueueQualification(type: SubjectType, ids: string | string[], trigger: string, opts: { process?: boolean } = {}) {
  const list = [...new Set(Array.isArray(ids) ? ids : [ids])].filter(Boolean);
  if (!list.length) return;
  await getDb()
    .insert(schema.qualificationJobs)
    .values(list.map((subjectId) => ({ subjectType: type, subjectId, trigger })))
    .onConflictDoNothing();
  if (opts.process === false) return;
  try {
    after(() => processQualificationQueue(Math.min(list.length, 25)).catch((e) => console.error("qualification queue", e)));
  } catch {
    // Outside a request (scripts): the cron job will process it.
  }
}

/** Claims and runs up to `limit` due jobs. Safe to run in parallel (SKIP LOCKED). */
export async function processQualificationQueue(limit = 25) {
  const db = getDb();
  const j = schema.qualificationJobs;
  const claimed = await db.execute<{ id: string; subject_type: SubjectType; subject_id: string; trigger: string; attempts: number }>(sql`
    update qualification_jobs set status = 'running', attempts = attempts + 1, updated_at = now()
     where id in (select id from qualification_jobs where status = 'queued' and run_after <= now() order by run_after limit ${limit} for update skip locked)
    returning id, subject_type, subject_id, trigger, attempts`);
  const jobs = claimed as unknown as { id: string; subject_type: SubjectType; subject_id: string; trigger: string; attempts: number }[];
  if (!jobs.length) return { processed: 0, failed: 0 };
  const t = await thresholds();
  const ai = getAi();
  let failed = 0;
  for (const job of jobs) {
    try {
      const r = await qualify(db as unknown as Db, job.subject_type, job.subject_id, { trigger: job.trigger, ai, thresholds: t });
      await db.update(j).set({ status: "done", lastError: r.ok ? (r.aiError ?? null) : r.error }).where(eq(j.id, job.id));
      // Rules are saved; let the AI have another go later.
      if (r.ok && r.aiError && job.attempts < MAX_ATTEMPTS)
        await db
          .insert(j)
          .values({ subjectType: job.subject_type, subjectId: job.subject_id, trigger: "ai-retry", attempts: job.attempts, runAfter: new Date(Date.now() + AI_RETRY_MIN * 60_000 * job.attempts) })
          .onConflictDoNothing();
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message.slice(0, 300) : "failed";
      const retry = job.attempts < MAX_ATTEMPTS;
      await db
        .update(j)
        .set({ status: retry ? "queued" : "failed", lastError: msg, runAfter: new Date(Date.now() + 2 ** job.attempts * 60_000) })
        .where(eq(j.id, job.id))
        .catch(() => {});
    }
  }
  return { processed: jobs.length, failed };
}

/** Cron: run due jobs and clean up old finished ones. */
export async function qualificationQueueJob() {
  let processed = 0;
  let failed = 0;
  for (let i = 0; i < 8; i++) {
    const r = await processQualificationQueue(25);
    processed += r.processed;
    failed += r.failed;
    if (r.processed < 25) break;
  }
  const j = schema.qualificationJobs;
  // Jobs stuck in "running" (instance stopped mid-run) go back to the queue.
  await getDb()
    .update(j)
    .set({ status: "queued" })
    .where(and(eq(j.status, "running"), lte(j.updatedAt, new Date(Date.now() - 15 * 60_000))));
  await getDb()
    .delete(j)
    .where(and(inArray(j.status, ["done"]), lte(j.updatedAt, new Date(Date.now() - 7 * 86_400_000))));
  return { processed, failed };
}
