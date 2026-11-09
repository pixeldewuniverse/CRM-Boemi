import { Pill } from "./pill";

export function PaymentPill({ status, depositPct }: { status: string; depositPct: number }) {
  if (status === "paid") return <Pill tone="ok">Paid</Pill>;
  if (status === "deposit") return <Pill tone="warn">DP {depositPct}%</Pill>;
  return <Pill tone="bad">Unpaid</Pill>;
}
