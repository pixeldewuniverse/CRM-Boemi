import { timingSafeEqual } from "node:crypto";
import { JourneyPayload, upsertJourneyLead } from "@/lib/journey";

const MAX_BODY = 16 * 1024;

function authorized(header: string | null): boolean {
  const key = process.env.JOURNEY_SYNC_KEY;
  if (!key || key.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${key}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Receives one guest from the aroma journey site. Idempotent: the same guest
 * sent again updates the same lead. Auth: Authorization: Bearer JOURNEY_SYNC_KEY.
 */
export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: "Payload too large" }, { status: 413 });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = JourneyPayload.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 422 });
  }

  try {
    const result = await upsertJourneyLead(parsed.data);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("journey lead sync failed", err);
    return Response.json({ error: "Could not save lead" }, { status: 500 });
  }
}
