import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";

/**
 * Typed settings kept in app_settings (key → JSON). Every key has defaults,
 * so the app works before anyone saves anything.
 */
const Numbering = {
  prefix: z.string().min(1).max(12).regex(/^[A-Za-z0-9-]+$/),
  /** Tokens: {PREFIX} {YYYY} {YY} {MM} {SEQ} */
  format: z.string().min(5).max(40).includes("{SEQ}"),
  seqDigits: z.coerce.number().int().min(2).max(6),
  reset: z.enum(["month", "year", "never"]),
};

export const SETTINGS = {
  company: z.object({
    name: z.string().min(1).max(120),
    address: z.string().max(300),
    phone: z.string().max(40),
    email: z.string().max(120),
    taxId: z.string().max(40),
    bank: z.string().max(200),
  }),
  quotation: z.object({
    ...Numbering,
    validDays: z.coerce.number().int().min(1).max(180),
    /** Max discount % a sales rep can give without a manager's approval. */
    salesDiscountLimit: z.coerce.number().min(0).max(100),
    terms: z.string().max(3000),
  }),
  order: z.object({
    ...Numbering,
    defaultDepositPct: z.coerce.number().int().min(0).max(100),
    terms: z.string().max(3000),
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type Settings<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]>;

export const DEFAULTS: { [K in SettingKey]: Settings<K> } = {
  company: {
    name: "BOEMI Botanicals",
    address: "Bali, Indonesia",
    phone: "",
    email: "",
    taxId: "",
    bank: "",
  },
  quotation: {
    prefix: "Q",
    format: "{PREFIX}-{YY}{MM}-{SEQ}",
    seqDigits: 3,
    reset: "month",
    validDays: 30,
    salesDiscountLimit: 10,
    terms:
      "Prices in Indonesian Rupiah. Delivery within Bali 3–5 working days after the deposit is received. This quotation is valid until the date shown.",
  },
  order: {
    prefix: "SO",
    format: "{PREFIX}-{YY}{MM}-{SEQ}",
    seqDigits: 3,
    reset: "month",
    defaultDepositPct: 50,
    terms: "Goods remain our property until paid in full. Please report any issue within 7 days of delivery.",
  },
};

/** `db` may be a transaction, so callers inside one don't need a second connection. */
export async function getSetting<K extends SettingKey>(key: K, db: Pick<ReturnType<typeof getDb>, "select"> = getDb()): Promise<Settings<K>> {
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, key));
  const merged = { ...DEFAULTS[key], ...(row?.value ?? {}) };
  const parsed = SETTINGS[key].safeParse(merged);
  return (parsed.success ? parsed.data : DEFAULTS[key]) as Settings<K>;
}
