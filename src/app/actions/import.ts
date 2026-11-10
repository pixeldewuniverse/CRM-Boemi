"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { IMPORT_ENTITIES, IMPORT_LABEL } from "@/lib/import/fields";
import { checkImport, commitChecked, errorReport, type RowStatus } from "@/lib/import/run";
import { canImportEntity } from "@/lib/permissions";

const Input = z.object({
  entity: z.enum(IMPORT_ENTITIES),
  fileName: z.string().min(1).max(200),
  text: z.string().min(1, "The file is empty."),
  mapping: z.record(z.string(), z.number().int().min(-1)).optional(),
  ownerId: z.uuid().optional(),
});

export type PreviewRow = { line: number; status: RowStatus; message?: string; updatable: boolean; values: Record<string, string> };
export type PreviewResult =
  | { ok: false; error: string; headers?: string[]; mapping?: Record<string, number>; missing?: string[] }
  | {
      ok: true;
      headers: string[];
      delimiter: string;
      mapping: Record<string, number>;
      total: number;
      counts: { new: number; duplicate: number; updatable: number; error: number };
      rows: PreviewRow[];
    };

const SAMPLE = 200;

/** Step 2: parse + validate. Nothing is saved; the file is sent again on commit. */
export async function previewImport(input: z.input<typeof Input>): Promise<PreviewResult> {
  const user = await verifyUser();
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { entity, text, mapping, ownerId } = parsed.data;
  if (!canImportEntity(user, entity)) return { ok: false, error: entity === "employees" ? "Only admins can import employees." : "Only admins and sales managers can import data." };

  const res = await checkImport(user, entity, text, { mapping, defaultOwnerId: ownerId });
  if ("error" in res) return { ok: false, error: res.error ?? "Could not read the file." };
  const { checked } = res;
  if ("missing" in res && res.missing?.length) {
    return { ok: false, error: `Map the required columns: ${res.missing.join(", ")}.`, headers: checked.headers, mapping: checked.mapping, missing: res.missing };
  }
  const by = (s: RowStatus) => checked.rows.filter((r) => r.status === s);
  const rows = [...by("error").slice(0, SAMPLE), ...by("duplicate").slice(0, SAMPLE), ...by("new").slice(0, SAMPLE)]
    .sort((a, b) => a.line - b.line)
    .map((r) => ({ line: r.line, status: r.status, message: r.message, updatable: Boolean(r.matchId), values: r.values }));
  return {
    ok: true,
    headers: checked.headers,
    delimiter: checked.delimiter,
    mapping: checked.mapping,
    total: checked.rows.length,
    counts: { new: by("new").length, duplicate: by("duplicate").length, updatable: by("duplicate").filter((r) => r.matchId).length, error: by("error").length },
    rows,
  };
}

const Commit = Input.extend({ mode: z.enum(["skip", "update"]) });
export type CommitImportResult =
  | { ok: false; error: string }
  | { ok: true; created: number; updated: number; skipped: number; failed: number; report: string | null; message: string };

/** Step 3: validate again on the server and save in transactions of 500 rows. */
export async function commitImport(input: z.input<typeof Commit>): Promise<CommitImportResult> {
  const user = await verifyUser();
  const parsed = Commit.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { entity, text, mapping, ownerId, mode, fileName } = parsed.data;
  if (!canImportEntity(user, entity)) return { ok: false, error: entity === "employees" ? "Only admins can import employees." : "Only admins and sales managers can import data." };

  const res = await checkImport(user, entity, text, { mapping, defaultOwnerId: ownerId });
  if ("error" in res) return { ok: false, error: res.error ?? "Could not read the file." };
  if ("missing" in res && res.missing?.length) return { ok: false, error: `Map the required columns: ${res.missing.join(", ")}.` };
  const result = await commitChecked(res.checked, mode, fileName);
  await audit({
    actorId: user.id,
    action: "import",
    entity: entity === "targets" ? "kpi_target" : entity,
    entityId: fileName,
    changes: { rows: res.checked.rows.length, created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed, duplicates: mode },
  });
  refresh();
  return {
    ok: true,
    ...result,
    report: errorReport(res.checked, mode),
    message: `${IMPORT_LABEL[entity]}: ${result.created} added, ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed.`,
  };
}
