import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { Panel, PreviewNotice } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getCurrentUser } from "@/lib/auth";
import { fdate, rp } from "@/lib/format";
import { previewData } from "@/lib/preview";

export const metadata: Metadata = { title: "Daily Sales" };

export default async function StoreSalesPage() {
  await getCurrentUser();
  const d = await previewData();
  return (
    <>
      <PageHeader href="/store/sales" />
      <PreviewNotice kind="Later" />
      <Panel flush>
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Transactions</th>
              <th className="num">Average basket</th>
              <th className="num">Sales</th>
              <th>Best seller</th>
            </tr>
          </thead>
          <tbody>
            {[...d.storeDays].reverse().map((x) => (
              <tr key={x.date}>
                <td className="font-semibold">
                  {fdate(x.date)} {x.weekend && <Pill tone="info">Weekend</Pill>}
                </td>
                <td className="num">{x.trx}</td>
                <td className="num">{rp(x.aov)}</td>
                <td className="num font-semibold">{rp(x.revenue)}</td>
                <td>{d.product(x.top)?.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
