import type { ReactNode } from "react";
import { findNav } from "@/lib/nav";
import { PageTitle } from "./page-title";

/** Page title + description taken from the menu config (src/lib/nav.ts). */
export function PageHeader({ href, actions, title }: { href: string; actions?: ReactNode; title?: string }) {
  const item = findNav(href)?.item;
  return <PageTitle title={title ?? item?.label ?? ""} description={item?.description} actions={actions} />;
}
