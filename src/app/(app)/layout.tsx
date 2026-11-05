import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { CategoryCount, ItemCount, SideFooter, TopRight } from "@/components/shell/slots";
import { NAV } from "@/lib/nav";

const COUNTED_ITEMS = ["tasks", "visits"];

/**
 * The shell (menus) is static and renders instantly; anything that needs
 * the signed-in user streams into its slot behind a Suspense boundary.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  const itemCounts = Object.fromEntries(
    COUNTED_ITEMS.map((key) => [
      key,
      <Suspense key={key} fallback={null}>
        <ItemCount itemKey={key} />
      </Suspense>,
    ]),
  );
  const categoryCounts = Object.fromEntries(
    NAV.filter((c) => c.items.some((i) => COUNTED_ITEMS.includes(i.key))).map((c) => [
      c.key,
      <Suspense key={c.key} fallback={null}>
        <CategoryCount categoryKey={c.key} />
      </Suspense>,
    ]),
  );

  return (
    <AppShell
      itemCounts={itemCounts}
      categoryCounts={categoryCounts}
      sideFooter={
        <Suspense fallback={<span className="h-8 animate-pulse rounded bg-surface-2" />}>
          <SideFooter />
        </Suspense>
      }
      topRight={
        <Suspense fallback={<span className="size-[30px] animate-pulse rounded-full bg-surface-2" />}>
          <TopRight />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
