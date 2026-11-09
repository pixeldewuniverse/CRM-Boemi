import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { Panel, PreviewNotice } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getCurrentUser } from "@/lib/auth";
import { num } from "@/lib/format";
import { previewData } from "@/lib/preview";

export const metadata: Metadata = { title: "Voucher & Promo" };
const TONE = { Active: "ok", Scheduled: "info", Done: "neutral" } as const;

export default async function PromoPage() {
  await getCurrentUser();
  const { promos } = await previewData();
  return (
    <>
      <PageHeader href="/ecommerce/promo" />
      <PreviewNotice kind="Later" />
      <Panel flush>
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th>Code</th>
              <th>Offer</th>
              <th>Channel</th>
              <th>Period</th>
              <th className="num">Used</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {promos.map((p) => (
              <tr key={p.code}>
                <td className="font-mono font-semibold">{p.code}</td>
                <td>{p.desc}</td>
                <td>{p.channel}</td>
                <td>{p.period}</td>
                <td className="num">{num(p.uses)}</td>
                <td>
                  <Pill tone={TONE[p.status as keyof typeof TONE] ?? "neutral"}>{p.status}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
