import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { verifyUser } from "@/lib/auth";
import { visibleUserIds } from "@/lib/scope";
import { loadBoard } from "@/lib/boards/access";
import { getStorage } from "@/lib/storage";
import { canOpen, findNav } from "@/lib/nav";

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

  // Board files: anyone who can see the board.
  if (objectKey.startsWith("boards/")) {
    const boardId = objectKey.split("/")[1];
    const ok = /^[0-9a-f-]{36}$/i.test(boardId) && (await loadBoard(user, boardId));
    if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
    const file = await (await getStorage()).read(objectKey);
    if (!file) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(file.stream, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        ...(file.size ? { "Content-Length": String(file.size) } : {}),
      },
    });
  }
  // Content calendar files: everyone who can open the Content Calendar, only for files still attached to a post.
  if (objectKey.startsWith("content/")) {
    const nav = findNav("/marketing/content");
    const [asset] = nav && canOpen(nav.item, user.role)
      ? await getDb().select({ name: schema.contentAssets.name }).from(schema.contentAssets).where(eq(schema.contentAssets.fileKey, objectKey)).limit(1)
      : [];
    const file = asset ? await (await getStorage()).read(objectKey) : null;
    if (!file) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(file.stream, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
        ...(file.size ? { "Content-Length": String(file.size) } : {}),
      },
    });
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
