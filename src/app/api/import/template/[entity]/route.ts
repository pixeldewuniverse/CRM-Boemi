import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { IMPORT_ENTITIES, IMPORT_EXAMPLES, IMPORT_FIELDS, type ImportEntity } from "@/lib/import/fields";
import { canImportEntity } from "@/lib/permissions";

/** CSV template: header row + 2 dummy example rows. */
export async function GET(_req: Request, ctx: RouteContext<"/api/import/template/[entity]">) {
  const user = await verifyUser();
  const { entity } = await ctx.params;
  if (!IMPORT_ENTITIES.includes(entity as ImportEntity)) return Response.json({ error: "Unknown entity" }, { status: 404 });
  if (!canImportEntity(user, entity)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const fields = IMPORT_FIELDS[entity as ImportEntity];
  const csv = toCsv(
    fields.map((f) => f.label),
    IMPORT_EXAMPLES[entity as ImportEntity].map((ex) => fields.map((f) => ex[f.key] ?? "")),
  );
  await audit({ actorId: user.id, action: "export", entity: "import_template", entityId: entity });
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="boemi-${entity}-template.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
