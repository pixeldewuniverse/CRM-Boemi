import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { Panel, PreviewNotice } from "@/components/ui/panel";
import { Meter } from "@/components/ui/meter";
import { Pill } from "@/components/ui/pill";
import { getCurrentUser } from "@/lib/auth";
import { previewData } from "@/lib/preview";

export const metadata: Metadata = { title: "Consigned Stock" };

export default async function ConsignedStockPage() {
  await getCurrentUser();
  const d = await previewData();
  return (
    <>
      <PageHeader href="/consignment/stock" />
      <PreviewNotice kind="Add-on" />
      <Panel flush>
        <table className="tbl min-w-[820px]">
          <thead>
            <tr>
              <th>Outlet</th>
              <th>Product</th>
              <th className="num">Consigned</th>
              <th className="num">Sold</th>
              <th className="num">On shelf</th>
              <th>Sell-through</th>
            </tr>
          </thead>
          <tbody>
            {d.outlets.map((o) => {
              const left = o.titip - o.sold;
              return (
                <tr key={o.acc + o.sku}>
                  <td className="font-semibold">{d.account(o.acc)?.n}</td>
                  <td>
                    {d.product(o.sku)?.n}
                    <p className="font-mono text-xs text-muted">{o.sku}</p>
                  </td>
                  <td className="num">{o.titip}</td>
                  <td className="num">{o.sold}</td>
                  <td className="num">
                    {left}
                    {left / o.titip < 0.25 && (
                      <span className="ml-2">
                        <Pill tone="warn">Restock</Pill>
                      </span>
                    )}
                  </td>
                  <td className="w-48">
                    <Meter value={o.sold} max={o.titip} label="Sell-through" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
