"use server";

import { z } from "zod";
import { verifyUser } from "@/lib/auth";
import { canOpen, NAV } from "@/lib/nav";
import { searchAll, type SearchGroup } from "@/lib/queries/search";

/** Command palette (Ctrl/Cmd+K). Read-only, scoped per role inside searchAll. */
export async function globalSearch(q: string): Promise<{ q: string; groups: SearchGroup[] }> {
  const user = await verifyUser();
  const parsed = z.string().max(200).safeParse(q);
  if (!parsed.success) return { q: "", groups: [] };
  const term = parsed.data.trim().toLowerCase();
  // Menu pages the role may open, for quick navigation.
  const pages =
    term.length >= 2
      ? NAV.filter((c) => !c.badge)
          .flatMap((c) => c.items.filter((i) => canOpen(i, user.role)).map((i) => ({ c, i })))
          .filter(({ c, i }) => `${c.label} ${i.label}`.toLowerCase().includes(term))
          .slice(0, 5)
          .map(({ c, i }) => ({ id: i.key, title: i.label, subtitle: c.label, href: i.href }))
      : [];
  const groups = await searchAll(user, parsed.data);
  return { q: parsed.data, groups: pages.length ? [{ type: "pages", label: "Pages", href: "", total: pages.length, hits: pages }, ...groups] : groups };
}
