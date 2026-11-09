import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { Panel, PreviewNotice } from "@/components/ui/panel";
import { Meter } from "@/components/ui/meter";
import { getCurrentUser } from "@/lib/auth";
import { fdate, num } from "@/lib/format";
import { previewData } from "@/lib/preview";

export const metadata: Metadata = { title: "Partner Outlets" };

export default async function OutletsPage() {
  await getCurrentUser();
  const d = await previewData();
  const ids = [...new Set(d.outlets.map((o) => o.acc))];
  const rows = ids.map((id) => {
    const lines = d.outlets.filter((o) => o.acc === id);
    return {
      id,
      account: d.account(id),
      skus: lines.length,
      consigned: lines.reduce((s, l) => s + l.titip, 0),
      sold: lines.reduce((s, l) => s + l.sold, 0),
      next: lines.map((l) => l.next).sort()[0],
    };
  });

  return (
    <>
      <PageHeader href="/consignment/outlets" />
      <PreviewNotice kind="Add-on" />
      <Panel flush>
        <table className="tbl min-w-[820px]">
          <thead>
            <tr>
              <th>Outlet</th>
              <th className="num">SKUs</th>
              <th className="num">Consigned</th>
              <th className="num">Sold</th>
              <th>Sell-through</th>
              <th className="num">Next restock</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <p className="font-semibold">{r.account?.n}</p>
                  <p className="text-xs text-muted">{r.account?.city}</p>
                </td>
                <td className="num">{r.skus}</td>
                <td className="num">{num(r.consigned)}</td>
                <td className="num">{num(r.sold)}</td>
                <td className="w-48">
                  <Meter value={r.sold} max={r.consigned} label="Sell-through" />
                </td>
                <td className="num">{fdate(r.next)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
