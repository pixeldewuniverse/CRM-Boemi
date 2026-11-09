import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { ExportLink } from "@/components/ui/export-link";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { rp } from "@/lib/format";
import { PRICE_TIERS, unitPrice, type PriceTier } from "@/lib/pricing";

export const metadata: Metadata = { title: "Products & Price List" };
const TIER_ORDER: PriceTier[] = ["retail", "reseller", "corporate", "hotel"];
const LOW_STOCK = 150;

export default async function ProductsPage() {
  await getCurrentUser();
  const rows = await getDb().select().from(schema.products).orderBy(asc(schema.products.category), asc(schema.products.name));

  return (
    <>
      <PageHeader
        href="/database/products"
        actions={
          <ExportLink entity="products" />
        }
      />
      <p className="text-[13px] text-muted">
        Tier prices = retail × {TIER_ORDER.map((t) => `${PRICE_TIERS[t].label} ${Math.round(PRICE_TIERS[t].factor * 100)}%`).join(" · ")}, rounded to Rp 100. Excl. PPN 11%.
      </p>
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No products.</Empty>
        ) : (
          <table className="tbl min-w-[1000px]">
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
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                  <td className="font-mono text-xs">{p.sku}</td>
                  <td>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted">{p.variant}</p>
                  </td>
                  <td>{p.category}</td>
                  {TIER_ORDER.map((t) => (
                    <td key={t} className={`num ${t === "retail" ? "font-semibold" : ""}`}>
                      {rp(unitPrice(p.price ?? 0, t))}
                    </td>
                  ))}
                  <td className="num">
                    {p.stock}
                    {p.stock < LOW_STOCK && (
                      <span className="ml-2">
                        <Pill tone="warn">Low</Pill>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
