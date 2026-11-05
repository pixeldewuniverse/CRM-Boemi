import { verifyUser } from "@/lib/auth";
import { getStorage } from "@/lib/storage";

/**
 * Streams a private file to a signed-in user.
 * TODO: add per-entity checks (e.g. sales can only open their own visit photos).
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/files/[...key]">,
) {
  await verifyUser();

  const { key } = await ctx.params;
  const objectKey = key.join("/");
  if (objectKey.includes("..")) {
    return Response.json({ error: "Invalid key" }, { status: 400 });
  }

  const file = await (await getStorage()).read(objectKey);
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });

  return new Response(file.stream, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      ...(file.size ? { "Content-Length": String(file.size) } : {}),
    },
  });
}
