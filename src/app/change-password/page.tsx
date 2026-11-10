import type { Metadata } from "next";
import { logout } from "@/app/actions/auth";
import { PasswordForm } from "@/components/forms/profile-forms";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Choose a new password" };

/** First sign-in with a temporary password (new account or reset by a Super Admin). */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  return (
    <div className="panel w-full max-w-md p-6">
      <h1 className="text-xl font-bold">Choose your password</h1>
      <p className="mt-1 text-[13px] text-muted">
        Hi {user.name}, you signed in with a temporary password. Enter it once more, then choose your own (at least 10 characters).
      </p>
      <div className="mt-5">
        <PasswordForm hasPassword stacked />
      </div>
      <form action={logout} className="mt-4 text-center">
        <button type="submit" className="text-[13px] text-muted hover:text-fg">
          Sign out
        </button>
      </form>
    </div>
  );
}
