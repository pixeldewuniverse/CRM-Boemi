import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { canOpen, findNav } from "@/lib/nav";
import { PageHeader } from "./page-header";

/**
 * Role check for a menu page. Returns the user, or `denied` markup to render
 * instead of the page (same rule the menu uses).
 */
export async function guard(href: string): Promise<{ user: CurrentUser; denied: React.ReactNode | null }> {
  const user = await getCurrentUser();
  const item = findNav(href)?.item;
  if (item && !canOpen(item, user.role)) {
    return {
      user,
      denied: (
        <>
          <PageHeader href={href} />
          <div className="panel p-8 text-center text-muted">This page is for Admins and Sales Managers only.</div>
        </>
      ),
    };
  }
  return { user, denied: null };
}
