import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { Panel, PreviewNotice } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getCurrentUser } from "@/lib/auth";
import { daysBetween, fdate } from "@/lib/format";
import { previewData } from "@/lib/preview";

export const metadata: Metadata = { title: "Restock Schedule" };

export default async function RestockPage() {
  await getCurrentUser();
  const d = await previewData();
  const rows = [...d.outlets].sort((a, b) => a.next.localeCompare(b.next));
  return (
    <>
      <PageHeader href="/consignment/restock" />
      <PreviewNotice kind="Add-on" />
      <Panel flush>
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th className="num">Date</th>
              <th>Outlet</th>
              <th>Product</th>
              <th className="num">Suggested qty</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const days = daysBetween(d.today, o.next);
              return (
                <tr key={o.acc + o.sku}>
                  <td className="num font-semibold">{fdate(o.next)}</td>
                  <td>{d.account(o.acc)?.n}</td>
                  <td>{d.product(o.sku)?.n}</td>
                  <td className="num">{o.sold}</td>
                  <td>
                    {days < 0 ? <Pill tone="bad">{-days} days late</Pill> : days <= 3 ? <Pill tone="warn">in {days} days</Pill> : <Pill tone="info">in {days} days</Pill>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <p className="text-[13px] text-muted">Suggested quantity replaces what sold since the last restock.</p>
    </>
  );
}
