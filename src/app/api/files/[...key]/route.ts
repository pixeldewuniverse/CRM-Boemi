import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { verifyUser } from "@/lib/auth";
import { visibleUserIds } from "@/lib/scope";
import { getStorage } from "@/lib/storage";

/**
 * Streams a private file to a signed-in user who may see the record it
 * belongs to (sales reps: only their own visits; profile photos: everyone).
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const user = await verifyUser();
  const { key } = await ctx.params;
  const objectKey = key.join("/");
  if (objectKey.includes("..") || !/^[\w./-]+$/.test(objectKey)) {
    return Response.json({ error: "Invalid key" }, { status: 400 });
  }

  // Profile photos: visible to every signed-in user.
  const [avatar] = objectKey.startsWith("avatars/")
    ? await getDb().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.avatarKey, objectKey)).limit(1)
    : [];
  if (!avatar) {
    const [visit] = await getDb()
      .select({ salesId: schema.visits.salesId })
      .from(schema.visits)
      .where(eq(schema.visits.photoKey, objectKey))
      .limit(1);
    if (!visit) return Response.json({ error: "Not found" }, { status: 404 });
    const visible = await visibleUserIds(user);
    if (visible && !visible.has(visit.salesId)) return Response.json({ error: "Not found" }, { status: 404 });
  }

  const file = await (await getStorage()).read(objectKey);
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });

  return new Response(file.stream, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      ...(file.size ? { "Content-Length": String(file.size) } : {}),
    },
  });
}
