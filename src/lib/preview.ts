import "server-only";
import demo from "@/db/demo/demo-data.json";
import { ymd } from "./format";
import { now } from "./scope";

/**
 * Sample data for modules outside the current scope (E-Commerce, Store,
 * Consignment). Read-only; dates are shifted so the demo's "today"
 * (2026-11-01) lines up with the real today.
 */
const DEMO_TODAY = Date.UTC(2026, 10, 1);

export async function previewData() {
  const today = ymd(await now());
  const offset = Date.parse(`${today}T00:00:00Z`) - DEMO_TODAY;
  const shift = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + offset).toISOString().slice(0, 10);
  const product = (sku: string) => demo.products.find((p) => p.sku === sku);
  const account = (id: string) => demo.accounts.find((a) => a.id === id);

  const STORE_TOP = ["BW-SEN-250", "CA-SEN-180", "BB-REM-150", "SS-MIN-050", "RS-TAN-100"];
  const storeDays = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) - (13 - i) * 86_400_000);
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const trx = 18 + ((i * 7) % 11) + (weekend ? 14 : 0);
    const aov = 245_000 + ((i * 37) % 9) * 12_000;
    return { date: d.toISOString().slice(0, 10), trx, aov, revenue: trx * aov, top: STORE_TOP[i % 5], weekend };
  });

  return {
    today,
    product,
    account,
    products: demo.products,
    ecom: demo.ecom.map((o) => ({ ...o, dt: shift(o.dt) })),
    channels: demo.channels,
    promos: demo.promos.map(([code, desc, channel, period, uses, status]) => ({ code, desc, channel, period, uses, status }) as {
      code: string; desc: string; channel: string; period: string; uses: number; status: string;
    }),
    outlets: demo.outlets.map((o) => ({ ...o, next: shift(o.next) })),
    settlements: demo.settlements,
    storeDays,
  };
}
