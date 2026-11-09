import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { Panel, PreviewNotice } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { getCurrentUser } from "@/lib/auth";
import { fdate, rp, rpk } from "@/lib/format";
import { previewData } from "@/lib/preview";

export const metadata: Metadata = { title: "Online Orders" };
const PAY = { Paid: "ok", "Awaiting payment": "warn" } as const;
const SHIP = { "Not shipped": "warn", Shipped: "info", Delivered: "ok" } as const;

export default async function OnlineOrdersPage() {
  await getCurrentUser();
  const d = await previewData();
  const rows = d.ecom.map((o) => ({ ...o, total: o.items.reduce((s, [sku, q]) => s + (d.product(sku as string)?.price ?? 0) * (q as number), 0) }));
  const toShip = rows.filter((o) => o.pay === "Paid" && o.ship === "Not shipped");

  return (
    <>
      <PageHeader href="/ecommerce/orders" />
      <PreviewNotice kind="Later" />
      <Stats
        items={[
          { label: "Orders shown", value: rows.length },
          { label: "Gross sales", value: rpk(rows.reduce((s, o) => s + o.total, 0)) },
          { label: "Paid, not shipped", value: toShip.length, tone: toShip.length ? "warn" : "default" },
          { label: "Channels", value: new Set(rows.map((o) => o.ch)).size },
        ]}
      />
      <Panel flush>
        <table className="tbl min-w-[860px]">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Items</th>
              <th className="num">Total</th>
              <th>Payment</th>
              <th>Shipping</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>
                  <p className="font-semibold">{o.id}</p>
                  <p className="text-xs text-muted">
                    {o.ch} · {fdate(o.dt)}
                  </p>
                </td>
                <td>
                  {o.cust}
                  <p className="text-xs text-muted">{o.city}</p>
                </td>
                <td className="text-[13px]">
                  {o.items.map(([sku, q]) => (
                    <p key={sku as string}>
                      {q as number}× {d.product(sku as string)?.n}
                    </p>
                  ))}
                </td>
                <td className="num font-semibold">{rp(o.total)}</td>
                <td>
                  <Pill tone={PAY[o.pay as keyof typeof PAY] ?? "neutral"}>{o.pay}</Pill>
                </td>
                <td>
                  <Pill tone={SHIP[o.ship as keyof typeof SHIP] ?? "neutral"}>{o.ship}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
