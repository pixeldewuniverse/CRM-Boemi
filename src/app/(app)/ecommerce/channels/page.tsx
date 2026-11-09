import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { PreviewNotice } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getCurrentUser } from "@/lib/auth";
import { num, rpk } from "@/lib/format";
import { previewData } from "@/lib/preview";

export const metadata: Metadata = { title: "Website & Marketplace" };

export default async function ChannelsPage() {
  await getCurrentUser();
  const { channels } = await previewData();
  return (
    <>
      <PageHeader href="/ecommerce/channels" />
      <PreviewNotice kind="Later" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {channels.map((c) => (
          <section key={c.n} className="panel flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-bold">{c.n}</h2>
                <p className="text-xs text-muted">{c.plat}</p>
              </div>
              <Pill tone={c.st === "Connected" ? "ok" : "warn"}>{c.st}</Pill>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-[13px]">
              <dt className="text-muted">Orders · 30d</dt>
              <dd className="text-right font-semibold tabular-nums">{num(c.o30)}</dd>
              <dt className="text-muted">GMV · 30d</dt>
              <dd className="text-right font-semibold tabular-nums">{rpk(c.gmv)}</dd>
              <dt className="text-muted">SKUs listed</dt>
              <dd className="text-right tabular-nums">{c.sku}</dd>
              <dt className="text-muted">Last sync</dt>
              <dd className="text-right">{c.sync}</dd>
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}
