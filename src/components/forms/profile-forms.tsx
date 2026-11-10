"use client";

import { useRef, useState, useTransition } from "react";
import { changePassword, removeAvatar, saveNotificationPreferences, updateProfile, uploadAvatar } from "@/app/actions/profile";
import { Avatar } from "@/components/avatar";
import { compressImage } from "@/lib/compress-image";
import { initialFormState } from "@/lib/forms";
import { TextField } from "./fields";
import { InlineForm } from "./form-dialog";

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  return (
    <InlineForm action={updateProfile}>
      <TextField name="name" label="Name" required defaultValue={name} autoComplete="name" />
      <TextField name="phone" label="Phone / WhatsApp" type="tel" inputMode="tel" defaultValue={phone ?? ""} autoComplete="tel" />
    </InlineForm>
  );
}

export function AvatarForm({ name, avatarKey }: { name: string; avatarKey: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const upload = (file: File | undefined) =>
    file &&
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("photo", await compressImage(file, 256, { square: true, name: "avatar.jpg" }));
        const r = await uploadAvatar(initialFormState, fd);
        setMsg({ ok: Boolean(r.ok), text: r.ok ? (r.message ?? "Saved.") : (r.error ?? "Upload failed.") });
      } catch {
        setMsg({ ok: false, text: "That file isn't a photo we can read." });
      }
      if (input.current) input.current.value = "";
    });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar name={name} avatarKey={avatarKey} size={72} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <label className={`btn ${pending ? "pointer-events-none opacity-60" : ""}`}>
            {pending ? "Uploading…" : avatarKey ? "Change photo" : "Upload photo"}
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {avatarKey && (
            <button
              type="button"
              className="btn text-bad"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await removeAvatar();
                  setMsg({ ok: Boolean(r.ok), text: r.message ?? "Photo removed." });
                })
              }
            >
              Remove
            </button>
          )}
        </div>
        <p className="text-xs text-muted">Optional. Cropped to a square and shrunk on your device before upload.</p>
        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  if (!hasPassword) return <p className="text-[13px] text-muted">You sign in without a password (invited or Google account). Ask an admin to set one up.</p>;
  return (
    <InlineForm action={changePassword} submitLabel="Change password" resetOnSuccess className="grid gap-3 sm:grid-cols-3">
      <TextField name="current" label="Current password" type="password" required autoComplete="current-password" />
      <TextField name="next" label="New password" type="password" required autoComplete="new-password" hint="At least 10 characters." />
      <TextField name="confirm" label="Repeat new password" type="password" required autoComplete="new-password" />
    </InlineForm>
  );
}

export type PrefRow = { type: string; label: string; inApp: boolean; email: boolean; push: boolean };

export function NotificationPrefsForm({ rows }: { rows: PrefRow[] }) {
  return (
    <InlineForm action={saveNotificationPreferences} submitLabel="Save notification settings" className="block">
      <div className="overflow-x-auto">
        <table className="tbl min-w-[520px] text-[13px]">
          <thead>
            <tr>
              <th>Notification</th>
              <th className="text-center">In app</th>
              <th className="text-center">Email</th>
              <th className="text-center">Phone / laptop</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type}>
                <td>{r.label}</td>
                {(["inApp", "email", "push"] as const).map((ch) => (
                  <td key={ch} className="text-center">
                    <input type="checkbox" name={`${r.type}:${ch}`} defaultChecked={r[ch]} aria-label={`${r.label}: ${ch === "inApp" ? "in app" : ch === "push" ? "phone / laptop" : "email"}`} className="size-4 accent-[var(--accent)]" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </InlineForm>
  );
}
