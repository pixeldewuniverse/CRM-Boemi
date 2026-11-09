import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { Panel, PreviewNotice } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getCurrentUser } from "@/lib/auth";
import { previewData } from "@/lib/preview";

export const metadata: Metadata = { title: "Store Stock" };
const MIN = 10;

export default async function StoreStockPage() {
  await getCurrentUser();
  const d = await previewData();
  const rows = d.products
    .map((p) => ({ ...p, qty: (Math.floor(p.price / 1000) % 47) + 3 }))
    .sort((a, b) => a.qty - b.qty);
  const low = rows.filter((r) => r.qty < MIN).length;

  return (
    <>
      <PageHeader href="/store/stock" />
      <PreviewNotice kind="Later" />
      {low > 0 && (
        <p className="text-[13px]">
          <Pill tone="warn">{low} items below minimum</Pill> — request a transfer from the central warehouse.
        </p>
      )}
      <Panel flush>
        <table className="tbl min-w-[680px]">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th className="num">In store</th>
              <th className="num">Minimum</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.sku}>
                <td className="font-mono text-xs">{p.sku}</td>
                <td>
                  {p.n}
                  <p className="text-xs text-muted">{p.size}</p>
                </td>
                <td className="num font-semibold">{p.qty}</td>
                <td className="num">{MIN}</td>
                <td>{p.qty < MIN ? <Pill tone="warn">Transfer needed</Pill> : <Pill tone="ok">OK</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
