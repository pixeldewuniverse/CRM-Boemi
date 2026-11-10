"use server";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { fieldErrors, formObject, parseRupiah, type FormState } from "@/lib/forms";
import { PRODUCT_UNITS } from "@/lib/labels";
import { canManageCatalog } from "@/lib/permissions";

const Product = z.object({
  sku: z
    .string("SKU is required.")
    .min(3, "SKU is required.")
    .max(30)
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and dashes only.")
    .transform((v) => v.toUpperCase()),
  name: z.string("Name is required.").min(2, "Name is required.").max(120),
  category: z.string().max(60).optional(),
  variant: z.string().max(60).optional(),
  unit: z.enum(PRODUCT_UNITS).default("pcs"),
  price: z.string("Enter the retail price."),
  active: z.literal("on").optional(),
});

async function guard() {
  const user = await verifyUser();
  return canManageCatalog(user) ? user : null;
}

function values(fd: FormData) {
  const parsed = Product.safeParse(formObject(fd));
  if (!parsed.success) return { error: fieldErrors(parsed.error) } as const;
  const price = parseRupiah(parsed.data.price);
  if (!price) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { price: "Enter the retail price." } } } as const;
  const { active, ...rest } = parsed.data;
  return { values: { ...rest, price, active: Boolean(active) } } as const;
}

async function skuTaken(sku: string, exceptId?: string) {
  const [row] = await getDb()
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(sql`upper(${schema.products.sku}) = ${sku}`, exceptId ? ne(schema.products.id, exceptId) : undefined))
    .limit(1);
  return Boolean(row);
}

export async function createProduct(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await guard();
  if (!user) return { ok: false, error: "Only admins and sales managers can change the price list." };
  if (!fd.has("active")) fd.set("active", "on"); // new products start active
  const v = values(fd);
  if ("error" in v) return v.error as FormState;
  if (await skuTaken(v.values.sku)) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { sku: "This SKU already exists." } };
  await getDb().insert(schema.products).values(v.values);
  await audit({ actorId: user.id, action: "create", entity: "product", entityId: v.values.sku, changes: { price: v.values.price } });
  refresh();
  return { ok: true, message: `${v.values.name} added.` };
}

export async function updateProduct(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await guard();
  if (!user) return { ok: false, error: "Only admins and sales managers can change the price list." };
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid product." };
  const v = values(fd);
  if ("error" in v) return v.error as FormState;
  const [before] = await getDb().select().from(schema.products).where(eq(schema.products.id, id.data));
  if (!before) return { ok: false, error: "Product not found." };
  if (await skuTaken(v.values.sku, id.data)) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { sku: "This SKU already exists." } };
  await getDb().update(schema.products).set(v.values).where(eq(schema.products.id, id.data));
  const changes: Record<string, unknown> = {};
  for (const k of ["sku", "name", "price", "active", "unit"] as const) if (before[k] !== v.values[k]) changes[k] = [before[k], v.values[k]];
  await audit({ actorId: user.id, action: "update", entity: "product", entityId: v.values.sku, changes });
  refresh();
  return { ok: true, message: "Product saved." };
}

/** Delete only if never quoted or ordered; otherwise it must be deactivated. */
export async function deleteProduct(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await guard();
  if (!user) return { ok: false, error: "Only admins and sales managers can change the price list." };
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid product." };
  const db = getDb();
  const [p] = await db.select().from(schema.products).where(eq(schema.products.id, id.data));
  if (!p) return { ok: false, error: "Product not found." };
  const [[q], [o]] = await Promise.all([
    db.select({ n: count() }).from(schema.quotationItems).where(eq(schema.quotationItems.productId, p.id)),
    db.select({ n: count() }).from(schema.orderItems).where(eq(schema.orderItems.productId, p.id)),
  ]);
  if (q.n + o.n > 0) return { ok: false, error: `${p.name} is used in ${q.n} quotation and ${o.n} order lines. Deactivate it instead.` };
  await db.delete(schema.products).where(eq(schema.products.id, p.id));
  await audit({ actorId: user.id, action: "delete", entity: "product", entityId: p.sku });
  refresh();
  return { ok: true, message: `${p.name} deleted.` };
}

export async function setProductActive(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await guard();
  if (!user) return { ok: false, error: "Only admins and sales managers can change the price list." };
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid product." };
  const active = fd.get("active") === "true";
  const [p] = await getDb().update(schema.products).set({ active }).where(eq(schema.products.id, id.data)).returning({ sku: schema.products.sku });
  if (!p) return { ok: false, error: "Product not found." };
  await audit({ actorId: user.id, action: active ? "activate" : "deactivate", entity: "product", entityId: p.sku });
  refresh();
  return { ok: true };
}
