import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { SESSION_COOKIE } from "./session-cookie";

export type SessionData = {
  userId?: string;
  /** users.session_version at sign-in; a password change makes older sessions invalid. */
  v?: number;
};

export { SESSION_COOKIE };

function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must be set (min. 32 characters)");
  }
  return {
    cookieName: SESSION_COOKIE,
    password,
    ttl: 60 * 60 * 12, // 12 hours
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}
