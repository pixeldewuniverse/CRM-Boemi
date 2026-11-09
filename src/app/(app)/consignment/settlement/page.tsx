import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { Panel, PreviewNotice } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getCurrentUser } from "@/lib/auth";
import { rp } from "@/lib/format";
import { previewData } from "@/lib/preview";

export const metadata: Metadata = { title: "Settlement" };
const TONE = { Paid: "ok", "Invoice sent": "info", "Awaiting invoice": "warn" } as const;

export default async function SettlementPage() {
  await getCurrentUser();
  const d = await previewData();
  return (
    <>
      <PageHeader href="/consignment/settlement" />
      <PreviewNotice kind="Add-on" />
      <Panel flush>
        <table className="tbl min-w-[860px]">
          <thead>
            <tr>
              <th>Settlement</th>
              <th>Outlet</th>
              <th className="num">Units sold</th>
              <th className="num">Sales value</th>
              <th className="num">Commission</th>
              <th className="num">Due to us</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {d.settlements.map((s) => {
              const commission = Math.round((s.val * s.kom) / 100);
              return (
                <tr key={s.id}>
                  <td>
                    <p className="font-semibold">{s.id}</p>
                    <p className="text-xs text-muted">{s.period}</p>
                  </td>
                  <td>{d.account(s.acc)?.n}</td>
                  <td className="num">{s.units}</td>
                  <td className="num">{rp(s.val)}</td>
                  <td className="num">
                    {rp(commission)}
                    <p className="text-xs text-muted">{s.kom}%</p>
                  </td>
                  <td className="num font-semibold">{rp(s.val - commission)}</td>
                  <td>
                    <Pill tone={TONE[s.st as keyof typeof TONE] ?? "neutral"}>{s.st}</Pill>
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
