import type { Metadata } from "next";
import { asc, sql } from "drizzle-orm";
import { NewProductButton, ProductRowActions } from "@/components/forms/crm-forms";
import { PageHeader } from "@/components/page/page-header";
import { ExportLink } from "@/components/ui/export-link";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { rp } from "@/lib/format";
import { canManageCatalog } from "@/lib/permissions";
import { PRICE_TIERS, unitPrice, type PriceTier } from "@/lib/pricing";

export const metadata: Metadata = { title: "Products & Price List" };
const HREF = "/database/products";
const TIER_ORDER: PriceTier[] = ["retail", "reseller", "corporate", "hotel"];
const LOW_STOCK = 150;

export default async function ProductsPage({ searchParams }: PageProps<"/database/products">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const show = params.show === "inactive" ? "inactive" : params.show === "all" ? "all" : undefined;
  const p = schema.products;
  // Single-table selects render bare column names, so qualify the outer id explicitly.
  const outerId = sql`${sql.identifier("products")}.${sql.identifier("id")}`;
  const rows = await getDb()
    .select({
      p,
      // Quoted or ordered at least once → can only be deactivated.
      used: sql<boolean>`exists (select 1 from ${schema.quotationItems} where ${schema.quotationItems.productId} = ${outerId})
        or exists (select 1 from ${schema.orderItems} where ${schema.orderItems.productId} = ${outerId})`,
    })
    .from(p)
    .orderBy(asc(p.category), asc(p.name));
  const manage = canManageCatalog(user);
  const categories = [...new Set(rows.map((r) => r.p.category).filter((c): c is string => Boolean(c)))];
  const active = rows.filter((r) => r.p.active).length;
  const visible = rows.filter((r) => (show === "all" ? true : show === "inactive" ? !r.p.active : r.p.active));

  return (
    <>
      <PageHeader
        href={HREF}
        actions={
          <>
            <ExportLink entity="products" />
            {manage && <NewProductButton categories={categories} />}
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          pathname={HREF}
          param="show"
          value={show}
          options={[
            { value: undefined, label: "Active", count: active },
            { value: "inactive", label: "Inactive", count: rows.length - active },
            { value: "all", label: "All", count: rows.length },
          ]}
        />
        <p className="text-[13px] text-muted">
          Tier prices = retail × {TIER_ORDER.map((t) => `${PRICE_TIERS[t].label} ${Math.round(PRICE_TIERS[t].factor * 100)}%`).join(" · ")}, rounded to Rp 100. Excl. PPN 11%.
        </p>
      </div>
      <Panel flush>
        {visible.length === 0 ? (
          <Empty>No products.</Empty>
        ) : (
          <table className="tbl min-w-[1080px]">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Category</th>
                {TIER_ORDER.map((t) => (
                  <th key={t} className="num">
                    {PRICE_TIERS[t].label}
                  </th>
                ))}
                <th className="num">Stock</th>
                {manage && (
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ p, used }) => (
                <tr key={p.id}>
                  <td className="font-mono text-xs">{p.sku}</td>
                  <td>
                    <p className={`font-semibold ${p.active ? "" : "text-muted"}`}>
                      {p.name} {!p.active && <Pill tone="neutral">Inactive</Pill>}
                    </p>
                    <p className="text-xs text-muted">
                      {[p.variant, `per ${p.unit}`].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td>{p.category}</td>
                  {TIER_ORDER.map((t) => (
                    <td key={t} className={`num ${t === "retail" ? "font-semibold" : ""}`}>
                      {rp(unitPrice(p.price ?? 0, t))}
                    </td>
                  ))}
                  <td className="num">
                    {p.stock}
                    {p.active && p.stock < LOW_STOCK && (
                      <span className="ml-2">
                        <Pill tone="warn">Low</Pill>
                      </span>
                    )}
                  </td>
                  {manage && (
                    <td>
                      <ProductRowActions
                        p={{ id: p.id, sku: p.sku, name: p.name, category: p.category, variant: p.variant, unit: p.unit, price: p.price, active: p.active }}
                        categories={categories}
                        used={Boolean(used)}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
