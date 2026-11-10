"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { formatNumber } from "@/lib/numbering";
import { canEditSettings } from "@/lib/permissions";
import { DEFAULTS, getSetting, SETTINGS, type SettingKey } from "@/lib/settings";

const Key = z.enum(Object.keys(SETTINGS) as [SettingKey, ...SettingKey[]]);

/** Saves one settings group (company, quotation or order) from its form. */
export async function saveSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canEditSettings(user)) return { ok: false, error: "Only admins and sales managers can change document settings." };
  const key = Key.safeParse(fd.get("key"));
  if (!key.success) return { ok: false, error: "Unknown settings group." };
  const raw = formObject(fd);
  delete raw.key;
  // Text fields may be cleared on purpose; formObject drops empties, so restore them.
  for (const [k, v] of Object.entries(DEFAULTS[key.data])) if (typeof v === "string" && !(k in raw) && fd.has(k)) raw[k] = "";
  const parsed = SETTINGS[key.data].safeParse(raw);
  if (!parsed.success) {
    const fe = fieldErrors(parsed.error);
    if (fe.fieldErrors?.format) fe.fieldErrors.format = "Must include {SEQ}, e.g. {PREFIX}-{YY}{MM}-{SEQ}.";
    return fe;
  }
  const value = parsed.data as Record<string, unknown>;
  if ("format" in value) {
    const sample = formatNumber(String(value.format), String(value.prefix), 1, Number(value.seqDigits));
    if (sample.length > 40) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { format: "Numbers would be too long." } };
  }
  const before = await getSetting(key.data);
  await getDb()
    .insert(schema.appSettings)
    .values({ key: key.data, value, updatedBy: user.id })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedBy: user.id, updatedAt: new Date() } });
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if ((before as Record<string, unknown>)[k] !== v) changes[k] = k === "terms" ? "(changed)" : [(before as Record<string, unknown>)[k], v];
  await audit({ actorId: user.id, action: "update", entity: "settings", entityId: key.data, changes });
  refresh();
  return { ok: true, message: "Settings saved." };
}
