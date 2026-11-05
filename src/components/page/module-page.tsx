import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canOpen, findNav } from "@/lib/nav";
import { PageTitle } from "./page-title";

const DEMO_URL = "https://demo.pixeldew.xyz";

/**
 * Shared page for every submenu that is not built yet: title and purpose
 * from the menu config, a link to the same screen in the clickable demo,
 * and role gating identical to the final page.
 */
export async function ModulePage({ pathname }: { pathname: string }) {
  const match = findNav(pathname);
  if (!match) notFound();
  const { category, item } = match;

  const user = await getCurrentUser();
  if (!canOpen(item, user.role)) {
    return (
      <>
        <PageTitle title={item.label} />
        <div className="panel p-8 text-center text-muted">
          This page is for Admins and Sales Managers only.
        </div>
      </>
    );
  }

  const scope =
    category.badge === "Later"
      ? { label: "Next stage", tone: "bg-info-soft text-info", note: "Planned for a later stage, outside the current Phase 1 scope." }
      : category.badge === "Add-on"
        ? { label: "Add-on", tone: "bg-warn-soft text-warn", note: "Optional add-on module, quoted separately." }
        : { label: "In development", tone: "bg-accent-soft text-accent", note: "Part of the current scope. The working screen will appear here once this module ships." };

  return (
    <>
      <PageTitle title={item.label} description={item.description} />
      <div className="panel flex flex-col items-start gap-3 p-6">
        <span className={`pill ${scope.tone}`}>{scope.label}</span>
        <p className="max-w-[62ch] text-muted">{scope.note}</p>
        <a
          href={`${DEMO_URL}/#${item.key}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn"
        >
          See this screen in the demo ↗
        </a>
      </div>
    </>
  );
}
