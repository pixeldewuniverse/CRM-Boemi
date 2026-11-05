import { CRON_JOBS, isAuthorizedCron } from "@/lib/cron";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/cron/[job]">,
) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await ctx.params;
  const run = CRON_JOBS[job];
  if (!run) return Response.json({ error: "Unknown job" }, { status: 404 });

  try {
    const result = await run();
    return Response.json({ job, ok: true, ...result });
  } catch (err) {
    console.error(`cron ${job} failed`, err);
    return Response.json({ job, ok: false }, { status: 500 });
  }
}
