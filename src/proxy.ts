import { NextResponse, type NextRequest } from "next/server";
import { HIDDEN_PREFIXES } from "@/lib/nav";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Optimistic check only: bounce visitors without a session cookie to /login,
 * and send hidden (Phase 2+) menu URLs to the dashboard.
 * Real authorization happens in the Data Access Layer (src/lib/auth.ts).
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  // Phase 2+ modules are hidden for now (see SHOW_LATER_PHASES in src/lib/nav.ts).
  const path = request.nextUrl.pathname;
  if (HIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.redirect(new URL("/dashboard", request.url));
  return NextResponse.next();
}

export const config = {
  // Public: login, API (checks its own auth), assets, PWA files.
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icons/|sw.js|manifest.webmanifest).*)"],
};
