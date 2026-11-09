import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Optimistic check only: bounce visitors without a session cookie to /login.
 * Real authorization happens in the Data Access Layer (src/lib/auth.ts).
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Public: login, API (checks its own auth), assets, PWA files.
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icons/|sw.js|manifest.webmanifest).*)"],
};
