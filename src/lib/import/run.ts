import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import { CSV_MAX_BYTES, CSV_MAX_ROWS, detectDelimiter, parseCsv, stripBom, toCsv } from "@/lib/csv";
import { findDuplicatesBulk } from "@/lib/duplicates";
import { parseRupiah } from "@/lib/forms";
import { ymd } from "@/lib/format";
import { PRODUCT_UNITS, SEGMENTS, TARGET_METRICS } from "@/lib/labels";
import { normalizePhone } from "@/lib/phone";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import { autoMap, IMPORT_FIELDS, type ImportEntity } from "./fields";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const IMPORT_SOURCE = "Import";
export const BATCH_SIZE = 500;

export type RowStatus = "new" | "duplicate" | "error";
export type CheckedRow = {
  line: number; // line number in the file (header = 1)
  status: RowStatus;
  message?: string;
  /** Duplicate that "Update" may overwrite (missing → always skipped). */
  matchId?: string;
  values: Record<string, string>;
  raw: string[];
  data?: Record<string, unknown>;
};

export type Checked = {
  entity: ImportEntity;
  headers: string[];
  delimiter: string;
  mapping: Record<string, number>;
  rows: CheckedRow[];
  /** Employees: email → user id resolved later (managers in the same file). */
  pendingManagers?: Map<number, string>;
};

/* ───────────── small parsers ───────────── */

const ci = <T extends string>(list: readonly T[], v: string) => list.find((x) => x.toLowerCase() === v.trim().toLowerCase());
const yesNo = (v: string): boolean | undefined | "invalid" => {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (["yes", "y", "ya", "true", "1", "active", "aktif"].includes(s)) return true;
  if (["no", "n", "tidak", "false", "0", "inactive", "nonaktif"].includes(s)) return false;
  return "invalid";
};
/** YYYY-MM-DD or DD/MM/YYYY (Indonesian spreadsheets). */
const isoDate = (v: string): string | undefined | "invalid" => {
  if (!v) return undefined;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (!m) {
    const d = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v.trim());
    if (d) m = [d[0], d[3], d[2], d[1]] as unknown as RegExpExecArray;
  }
  if (!m) return "invalid";
  const s = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const t = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== s ? "invalid" : s;
};
const Email = z.email().max(254);
/** A function (not an inline check) so TypeScript doesn't narrow status away after fail(). */
const isErr = (r: CheckedRow) => r.status === "error";
const text = (max: number) => z.string().max(max, `Max ${max} characters.`);

/* ───────────── read & map the file ───────────── */

export function readFile(entity: ImportEntity, rawText: string, mapping?: Record<string, number>) {
  if (Buffer.byteLength(rawText, "utf8") > CSV_MAX_BYTES) return { error: "The file is larger than 5 MB." } as const;
  const text = stripBom(rawText);
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (rows.length < 2) return { error: "The file has no data rows. The first row must be the column headers." } as const;
  const headers = rows[0].map((h) => h.trim());
  const data = rows.slice(1);
  if (data.length > CSV_MAX_ROWS) return { error: `The file has ${data.length.toLocaleString("en-US")} rows. The limit is ${CSV_MAX_ROWS.toLocaleString("en-US")} per import — split it into smaller files.` } as const;
  const fields = IMPORT_FIELDS[entity];
  const map: Record<string, number> = {};
  const suggested = autoMap(entity, headers);
  for (const f of fields) {
    const v = mapping?.[f.key];
    map[f.key] = typeof v === "number" && v >= -1 && v < headers.length ? v : suggested[f.key];
  }
  const missing = fields.filter((f) => f.required && map[f.key] < 0).map((f) => f.label);
  return { headers, delimiter, data, mapping: map, missing } as const;
}

/* ───────────── validate (shared by preview and commit) ───────────── */

export async function checkImport(user: CurrentUser, entity: ImportEntity, rawText: string, opts: { mapping?: Record<string, number>; defaultOwnerId?: string }) {
  const file = readFile(entity, rawText, opts.mapping);
  if ("error" in file) return { error: file.error } as const;
  const fields = IMPORT_FIELDS[entity];
  const rows: CheckedRow[] = file.data.map((raw, i) => {
    const values: Record<string, string> = {};
    for (const f of fields) values[f.key] = file.mapping[f.key] >= 0 ? (raw[file.mapping[f.key]] ?? "").trim() : "";
    return { line: i + 2, status: "new", values, raw };
  });
  const checked: Checked = { entity, headers: file.headers, delimiter: file.delimiter, mapping: file.mapping, rows };
  if (file.missing.length) return { checked, missing: file.missing } as const;

  const db = getDb();
  const fail = (r: CheckedRow, message: string) => {
    if (r.status !== "error") Object.assign(r, { status: "error", message, data: undefined, matchId: undefined });
  };
  /** Same key earlier in the file → duplicate of that row. */
  const seen = new Map<string, number>();
  const inFile = (r: CheckedRow, keys: string[]) => {
    for (const k of keys) {
      const first = seen.get(k);
      if (first !== undefined) {
        r.status = "duplicate";
        r.message = `Same ${k.split(":")[0]} as row ${first} in this file.`;
        r.matchId = undefined;
        return true;
      }
    }
    for (const k of keys) seen.set(k, r.line);
    return false;
  };

  // People that rows may point at (owners, reps, managers).
  const users = await db
    .select({ id: schema.users.id, email: schema.users.email, role: schema.users.role, active: schema.users.active })
    .from(schema.users);
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const sellers = (u: (typeof users)[number] | undefined) => u && u.active && ["sales", "sales_manager"].includes(u.role);
  const defaultOwner = opts.defaultOwnerId && users.some((u) => u.id === opts.defaultOwnerId && sellers(u)) ? opts.defaultOwnerId : user.id;
  const ownerFor = (r: CheckedRow): string | null => {
    const e = r.values.ownerEmail;
    if (!e) return defaultOwner;
    const u = byEmail.get(e.toLowerCase());
    if (!sellers(u)) {
      fail(r, `Owner ${e} is not an active sales user.`);
      return null;
    }
    return u!.id;
  };
  const phoneOf = (r: CheckedRow) => {
    if (!r.values.phone) return null;
    const p = normalizePhone(r.values.phone);
    if (!p) fail(r, `Invalid phone number "${r.values.phone}".`);
    return p;
  };
  const emailOf = (r: CheckedRow, key = "email") => {
    const v = r.values[key];
    if (!v) return null;
    if (!Email.safeParse(v).success) {
      fail(r, `Invalid email "${v}".`);
      return null;
    }
    return v.toLowerCase();
  };
  const required = (r: CheckedRow) => {
    for (const f of fields) if (f.required && !r.values[f.key]) return fail(r, `${f.label} is required.`), false;
    return true;
  };
  const limit = (r: CheckedRow, key: string, max: number) => {
    if (!r.values[key]) return;
    const res = text(max).safeParse(r.values[key]);
    if (!res.success) fail(r, `${fields.find((f) => f.key === key)?.label}: ${res.error.issues[0].message}`);
  };

  switch (entity) {
    case "accounts":
    case "leads": {
      const nameKey = entity === "accounts" ? "name" : "company";
      const campaigns = entity === "leads" ? await db.select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns) : [];
      for (const r of rows) {
        if (!required(r)) continue;
        for (const [k, max] of [[nameKey, 160], ["city", 120], ["address", 300], ["instagram", 60], ["contactName", 120], ["contactPosition", 120], ["picName", 120], ["note", 1000]] as const) limit(r, k, max);
        const segment = ci(SEGMENTS, r.values.segment);
        if (!segment) fail(r, `Unknown segment "${r.values.segment}". Use: ${SEGMENTS.join(", ")}.`);
        const phone = phoneOf(r);
        const email = emailOf(r);
        const ownerId = ownerFor(r);
        if (isErr(r)) continue;
        if (entity === "leads" && !phone && !email) {
          fail(r, "Add a phone number or an email.");
          continue;
        }
        const data: Record<string, unknown> = { name: r.values[nameKey], segment, phone, email, city: r.values.city || null, ownerId };
        if (entity === "accounts") {
          const status = r.values.status ? ci(["prospect", "active", "inactive"] as const, r.values.status) : "prospect";
          const consent = yesNo(r.values.consent);
          if (!status) fail(r, `Status must be prospect, active or inactive.`);
          if (consent === "invalid") fail(r, "Marketing consent must be yes or no.");
          Object.assign(data, { status, consent, address: r.values.address || null, instagram: r.values.instagram.replace(/^@/, "") || null, contactName: r.values.contactName || null, contactPosition: r.values.contactPosition || null });
        } else {
          const received = isoDate(r.values.receivedOn);
          if (received === "invalid") fail(r, `Received on must be a date (YYYY-MM-DD), got "${r.values.receivedOn}".`);
          let campaignId: string | null = null;
          if (r.values.campaign) {
            campaignId = campaigns.find((c) => c.name.toLowerCase() === r.values.campaign.toLowerCase())?.id ?? null;
            if (!campaignId) fail(r, `Campaign "${r.values.campaign}" not found.`);
          }
          Object.assign(data, { picName: r.values.picName || null, note: r.values.note || null, receivedOn: received, campaignId });
        }
        if (isErr(r)) continue;
        r.data = data;
        inFile(r, [phone && `phone:${phone}`, email && `email:${email}`].filter(Boolean) as string[]);
      }
      const live = rows.filter((r) => r.status === "new");
      const dups = await findDuplicatesBulk(
        live.map((r) => r.data!.phone as string).filter(Boolean),
        live.map((r) => r.data!.email as string).filter(Boolean),
      );
      for (const r of live) {
        const m = dups.get(`phone:${r.data!.phone}`) ?? dups.get(`email:${r.data!.email}`);
        if (!m) continue;
        r.status = "duplicate";
        const who = `${m.name}${m.owner ? ` (owner ${m.owner})` : ""}`;
        const sameKind = (entity === "accounts" && m.kind === "account") || (entity === "leads" && m.kind === "lead");
        r.matchId = sameKind ? m.id : undefined;
        r.message = sameKind ? `Already ${m.kind === "account" ? "an account" : "a lead"}: ${who}.` : `Already ${m.kind === "account" ? "an account" : "a lead"}: ${who} — can't be updated from a ${entity === "accounts" ? "account" : "lead"} import.`;
      }
      break;
    }

    case "contacts": {
      const accounts = await db.select({ id: schema.customers.id, name: schema.customers.name }).from(schema.customers);
      const byName = new Map<string, string[]>();
      for (const a of accounts) byName.set(a.name.toLowerCase(), [...(byName.get(a.name.toLowerCase()) ?? []), a.id]);
      const accountName = new Map(accounts.map((a) => [a.id, a.name]));
      for (const r of rows) {
        if (!required(r)) continue;
        for (const [k, max] of [["name", 120], ["position", 120], ["notes", 1000]] as const) limit(r, k, max);
        const ids = byName.get(r.values.account.toLowerCase()) ?? [];
        if (ids.length === 0) fail(r, `Account "${r.values.account}" not found. Use the exact account name.`);
        else if (ids.length > 1) fail(r, `${ids.length} accounts are called "${r.values.account}". Rename one or add this contact on the account page.`);
        const phone = phoneOf(r);
        const email = emailOf(r);
        const dm = yesNo(r.values.decisionMaker);
        if (dm === "invalid") fail(r, "Decision maker must be yes or no.");
        if (isErr(r)) continue;
        r.data = { customerId: ids[0], name: r.values.name, position: r.values.position || null, phone, email, decisionMaker: dm, notes: r.values.notes || null };
        inFile(r, [phone && `phone:${phone}`, email && `email:${email}`].filter(Boolean) as string[]);
      }
      const live = rows.filter((r) => r.status === "new");
      const phones = live.map((r) => r.data!.phone as string).filter(Boolean);
      const emails = live.map((r) => r.data!.email as string).filter(Boolean);
      const existing = phones.length || emails.length
        ? await db
            .select({ id: schema.contacts.id, name: schema.contacts.name, customerId: schema.contacts.customerId, phone: schema.contacts.phoneE164, email: schema.contacts.email })
            .from(schema.contacts)
            .where(sql`${phones.length ? inArray(schema.contacts.phoneE164, phones) : sql`false`} or ${emails.length ? inArray(sql`lower(${schema.contacts.email})`, emails) : sql`false`}`)
        : [];
      for (const r of live) {
        const m = existing.find((c) => (r.data!.phone && c.phone === r.data!.phone) || (r.data!.email && c.email?.toLowerCase() === r.data!.email));
        if (!m) continue;
        r.status = "duplicate";
        if (m.customerId === r.data!.customerId) {
          r.matchId = m.id;
          r.message = `Already a contact: ${m.name}.`;
        } else r.message = `Already a contact: ${m.name} at ${accountName.get(m.customerId)} — can't move it from an import.`;
      }
      break;
    }

    case "products": {
      for (const r of rows) {
        if (!required(r)) continue;
        for (const [k, max] of [["name", 120], ["category", 60], ["variant", 60]] as const) limit(r, k, max);
        const sku = r.values.sku.toUpperCase();
        if (!/^[A-Z0-9-]{3,30}$/.test(sku)) fail(r, `SKU "${r.values.sku}" must be 3–30 letters, numbers or dashes.`);
        const price = parseRupiah(r.values.price);
        if (!price) fail(r, `Retail price "${r.values.price}" is not a number.`);
        const unit = r.values.unit ? ci(PRODUCT_UNITS, r.values.unit) : "pcs";
        if (!unit) fail(r, `Unit must be one of: ${PRODUCT_UNITS.join(", ")}.`);
        const stock = r.values.stock ? Number(r.values.stock.replace(/[.,\s]/g, "")) : undefined;
        if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) fail(r, `Stock "${r.values.stock}" must be a whole number.`);
        const active = yesNo(r.values.active);
        if (active === "invalid") fail(r, "Active must be yes or no.");
        if (isErr(r)) continue;
        r.data = { sku, name: r.values.name, category: r.values.category || null, variant: r.values.variant || null, unit, price, stock, active };
        inFile(r, [`SKU:${sku}`]);
      }
      const live = rows.filter((r) => r.status === "new");
      const skus = live.map((r) => r.data!.sku as string);
      const existing = skus.length ? await db.select({ id: schema.products.id, sku: schema.products.sku, name: schema.products.name }).from(schema.products).where(inArray(sql`upper(${schema.products.sku})`, skus)) : [];
      for (const r of live) {
        const m = existing.find((p) => p.sku.toUpperCase() === r.data!.sku);
        if (m) Object.assign(r, { status: "duplicate", matchId: m.id, message: `SKU already exists: ${m.name}.` });
      }
      break;
    }

    case "employees": {
      const fileEmails = new Set(rows.map((r) => r.values.email.toLowerCase()).filter(Boolean));
      checked.pendingManagers = new Map();
      for (const r of rows) {
        if (!required(r)) continue;
        for (const [k, max] of [["name", 120], ["position", 120], ["department", 120], ["region", 120]] as const) limit(r, k, max);
        const email = emailOf(r);
        const role = (ROLES as readonly string[]).find((x) => x === r.values.role.trim().toLowerCase().replace(/\s+/g, "_")) ?? (Object.entries(ROLE_LABEL).find(([, l]) => l.toLowerCase() === r.values.role.trim().toLowerCase())?.[0] as Role | undefined);
        if (!role) fail(r, `Unknown role "${r.values.role}". Use: ${Object.values(ROLE_LABEL).join(", ")}.`);
        const phone = phoneOf(r);
        const joined = isoDate(r.values.joinedOn);
        if (joined === "invalid") fail(r, `Joined on must be a date (YYYY-MM-DD), got "${r.values.joinedOn}".`);
        const managerEmail = emailOf(r, "managerEmail");
        let managerId: string | null = null;
        if (managerEmail) {
          if (managerEmail === email) fail(r, "An employee can't be their own manager.");
          else if (byEmail.has(managerEmail)) managerId = byEmail.get(managerEmail)!.id;
          else if (fileEmails.has(managerEmail)) checked.pendingManagers.set(r.line, managerEmail);
          else fail(r, `Manager ${managerEmail} not found (not a user and not in this file).`);
        }
        if (isErr(r)) continue;
        r.data = { name: r.values.name, email, role, position: r.values.position || null, department: r.values.department || null, region: r.values.region || null, phone, managerId, joinedOn: joined };
        inFile(r, [`email:${email}`]);
        const existing = byEmail.get(email!);
        if (r.status === "new" && existing) {
          r.status = "duplicate";
          if (existing.id === user.id && role !== existing.role) r.message = "This is your own account — change your role in Users instead.";
          else Object.assign(r, { matchId: existing.id, message: `User already exists: ${email}.` });
        }
      }
      break;
    }

    case "targets": {
      const metrics = Object.keys(TARGET_METRICS);
      for (const r of rows) {
        if (!required(r)) continue;
        const u = byEmail.get(r.values.repEmail.toLowerCase());
        if (!sellers(u)) fail(r, `${r.values.repEmail} is not an active sales user.`);
        const metric = metrics.find((m) => m === r.values.metric.trim().toLowerCase().replace(/[\s-]+/g, "_")) ?? Object.entries(TARGET_METRICS).find(([, d]) => d.label.toLowerCase() === r.values.metric.trim().toLowerCase())?.[0];
        if (!metric) fail(r, `Unknown metric "${r.values.metric}". Use: ${metrics.join(", ")}.`);
        const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(r.values.period.trim()) ? r.values.period.trim() : null;
        if (!period) fail(r, `Period must be YYYY-MM, got "${r.values.period}".`);
        const target = parseRupiah(r.values.target);
        if (!target) fail(r, `Target "${r.values.target}" must be a number above 0.`);
        if (isErr(r)) continue;
        r.data = { userId: u!.id, metric, period, target };
        inFile(r, [`target:${u!.id}:${metric}:${period}`]);
      }
      const live = rows.filter((r) => r.status === "new");
      const periods = [...new Set(live.map((r) => r.data!.period as string))];
      const existing = periods.length ? await db.select().from(schema.kpiTargets).where(inArray(schema.kpiTargets.period, periods)) : [];
      for (const r of live) {
        const m = existing.find((t) => t.userId === r.data!.userId && t.metric === r.data!.metric && t.period === r.data!.period);
        if (m) Object.assign(r, { status: "duplicate", matchId: m.id, message: `Target already set (${m.target.toLocaleString("en-US")}).` });
      }
      break;
    }
  }
  return { checked } as const;
}

/* ───────────── commit ───────────── */

export type CommitResult = { created: number; updated: number; skipped: number; failed: number; failures: { line: number; message: string }[] };

/** Only fields that have a value in the file (empty cells never erase data). */
const filled = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));

async function writeRow(tx: Tx, entity: ImportEntity, r: CheckedRow, mode: "skip" | "update", fileName: string): Promise<"created" | "updated" | "skipped"> {
  const d = r.data!;
  const update = r.status === "duplicate" && mode === "update" && r.matchId;
  if (r.status === "duplicate" && !update) return "skipped";
  switch (entity) {
    case "accounts": {
      const values = {
        name: d.name as string,
        businessType: d.segment as string,
        status: d.status as "prospect" | "active" | "inactive",
        city: d.city as string | null,
        address: d.address as string | null,
        phoneE164: d.phone as string | null,
        email: d.email as string | null,
        instagram: d.instagram as string | null,
        ownerId: d.ownerId as string,
        marketingConsent: d.consent as boolean | undefined,
        consentAt: d.consent === true ? new Date() : undefined,
      };
      let id = r.matchId;
      if (update) {
        const patch = filled({ ...values, ownerId: r.values.ownerEmail ? values.ownerId : undefined, status: r.values.status ? values.status : undefined, consentAt: undefined });
        if (d.consent !== undefined) Object.assign(patch, { marketingConsent: d.consent, consentAt: d.consent ? new Date() : null });
        await tx.update(schema.customers).set(patch).where(eq(schema.customers.id, id!));
      } else {
        const [row] = await tx
          .insert(schema.customers)
          .values({ ...values, marketingConsent: Boolean(d.consent), consentAt: d.consent ? new Date() : null, source: IMPORT_SOURCE, sourceDetail: fileName })
          .returning({ id: schema.customers.id });
        id = row.id;
      }
      if (d.contactName) {
        const [has] = await tx
          .select({ id: schema.contacts.id })
          .from(schema.contacts)
          .where(and(eq(schema.contacts.customerId, id!), sql`lower(${schema.contacts.name}) = ${(d.contactName as string).toLowerCase()}`));
        if (!has) {
          await tx.insert(schema.contacts).values({ customerId: id!, name: d.contactName as string, position: d.contactPosition as string | null, phoneE164: d.phone as string | null, email: d.email as string | null, isDecisionMaker: true });
        }
      }
      return update ? "updated" : "created";
    }
    case "contacts": {
      const values = { customerId: d.customerId as string, name: d.name as string, position: d.position as string | null, phoneE164: d.phone as string | null, email: d.email as string | null, isDecisionMaker: d.decisionMaker as boolean | undefined, notes: d.notes as string | null };
      if (update) await tx.update(schema.contacts).set(filled(values)).where(eq(schema.contacts.id, r.matchId!));
      else await tx.insert(schema.contacts).values({ ...values, isDecisionMaker: Boolean(d.decisionMaker) });
      return update ? "updated" : "created";
    }
    case "leads": {
      const values = {
        company: d.name as string,
        picName: d.picName as string | null,
        phoneE164: d.phone as string | null,
        email: d.email as string | null,
        segment: d.segment as string,
        city: d.city as string | null,
        campaignId: d.campaignId as string | null,
        ownerId: d.ownerId as string,
        note: d.note as string | null,
        receivedOn: d.receivedOn as string | undefined,
      };
      if (update) await tx.update(schema.leads).set(filled({ ...values, ownerId: r.values.ownerEmail ? values.ownerId : undefined })).where(eq(schema.leads.id, r.matchId!));
      else await tx.insert(schema.leads).values({ ...values, receivedOn: values.receivedOn ?? ymd(new Date()), source: IMPORT_SOURCE, status: "new" });
      return update ? "updated" : "created";
    }
    case "products": {
      const values = { sku: d.sku as string, name: d.name as string, category: d.category as string | null, variant: d.variant as string | null, unit: d.unit as string, price: d.price as number, stock: d.stock as number | undefined, active: d.active as boolean | undefined };
      if (update) await tx.update(schema.products).set(filled({ ...values, sku: undefined, unit: r.values.unit ? values.unit : undefined })).where(eq(schema.products.id, r.matchId!));
      else await tx.insert(schema.products).values({ ...values, stock: values.stock ?? 0, active: values.active ?? true });
      return update ? "updated" : "created";
    }
    case "employees": {
      const values = { name: d.name as string, email: d.email as string, role: d.role as Role, position: d.position as string | null, department: d.department as string | null, region: d.region as string | null, phone: d.phone as string | null, managerId: d.managerId as string | null, joinedOn: d.joinedOn as string | undefined };
      // Imported users stay inactive and without a password until they're invited.
      if (update) await tx.update(schema.users).set(filled({ ...values, email: undefined })).where(eq(schema.users.id, r.matchId!));
      else await tx.insert(schema.users).values({ ...values, active: false, passwordHash: null });
      return update ? "updated" : "created";
    }
    case "targets": {
      if (update) await tx.update(schema.kpiTargets).set({ target: d.target as number }).where(eq(schema.kpiTargets.id, r.matchId!));
      else await tx.insert(schema.kpiTargets).values({ userId: d.userId as string, metric: d.metric as string, period: d.period as string, target: d.target as number });
      return update ? "updated" : "created";
    }
  }
}

/** Writes valid rows in transactions of BATCH_SIZE; a failing batch is retried row by row. */
export async function commitChecked(checked: Checked, mode: "skip" | "update", fileName: string): Promise<CommitResult> {
  const db = getDb();
  const res: CommitResult = { created: 0, updated: 0, skipped: 0, failed: 0, failures: [] };
  const writable = checked.rows.filter((r) => r.status !== "error");
  res.failed = checked.rows.length - writable.length;
  for (let i = 0; i < writable.length; i += BATCH_SIZE) {
    const batch = writable.slice(i, i + BATCH_SIZE);
    try {
      const counts = await db.transaction(async (tx) => {
        const c = { created: 0, updated: 0, skipped: 0 };
        for (const r of batch) c[await writeRow(tx, checked.entity, r, mode, fileName)]++;
        return c;
      });
      res.created += counts.created;
      res.updated += counts.updated;
      res.skipped += counts.skipped;
    } catch {
      for (const r of batch) {
        try {
          const outcome = await db.transaction((tx) => writeRow(tx, checked.entity, r, mode, fileName));
          res[outcome]++;
        } catch (err) {
          res.failed++;
          const msg = err instanceof Error && /unique|duplicate key/i.test(`${err.message} ${(err as { cause?: Error }).cause?.message ?? ""}`) ? "Saved by someone else in the meantime (duplicate)." : "Could not be saved.";
          res.failures.push({ line: r.line, message: msg });
          Object.assign(r, { status: "error", message: msg });
        }
      }
    }
  }
  // Managers who were created in the same file.
  if (checked.entity === "employees" && checked.pendingManagers?.size) {
    const emails = [...new Set(checked.pendingManagers.values())];
    const managers = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(sql`lower(${schema.users.email})`, emails));
    for (const r of writable) {
      const me = checked.pendingManagers.get(r.line);
      const m = me && managers.find((x) => x.email.toLowerCase() === me);
      if (m && r.data?.email) await db.update(schema.users).set({ managerId: m.id }).where(sql`lower(${schema.users.email}) = ${r.data.email as string}`);
    }
  }
  return res;
}

/** Rows that weren't saved (errors + skipped duplicates) with the reason, for download. */
export function errorReport(checked: Checked, mode: "skip" | "update") {
  const rows = checked.rows.filter((r) => r.status === "error" || (r.status === "duplicate" && !(mode === "update" && r.matchId)));
  if (!rows.length) return null;
  return toCsv(
    ["Row", "Result", "Reason", ...checked.headers],
    rows.map((r) => [r.line, r.status === "error" ? "Failed" : "Skipped (duplicate)", r.message ?? "", ...r.raw]),
  );
}
