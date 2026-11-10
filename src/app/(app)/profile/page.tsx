import type { Metadata } from "next";
import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { AvatarForm, NotificationPrefsForm, PasswordForm, ProfileForm } from "@/components/forms/profile-forms";
import { PageTitle } from "@/components/page/page-title";
import { Panel } from "@/components/ui/panel";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fdate, fdatetime } from "@/lib/format";
import { NOTIFICATION_TYPES } from "@/lib/notifications";
import { ROLE_LABEL } from "@/lib/roles";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const user = await getCurrentUser();
  const db = getDb();
  const manager = alias(schema.users, "manager");
  const u = schema.users;
  const [[me], prefs, [devices]] = await Promise.all([
    db
      .select({ name: u.name, email: u.email, phone: u.phone, role: u.role, position: u.position, department: u.department, region: u.region, joinedOn: u.joinedOn, lastLoginAt: u.lastLoginAt, avatarKey: u.avatarKey, hasPassword: u.passwordHash, manager: manager.name })
      .from(u)
      .leftJoin(manager, eq(manager.id, u.managerId))
      .where(eq(u.id, user.id)),
    db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, user.id)),
    db.select({ n: count() }).from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, user.id)),
  ]);
  const rows = Object.entries(NOTIFICATION_TYPES).map(([type, d]) => {
    const p = prefs.find((x) => x.type === type);
    return { type, label: d.label, inApp: p?.inApp ?? true, email: p?.email ?? d.emailDefault, push: p?.push ?? true };
  });

  return (
    <>
      <PageTitle title="My profile" description={`${me.email} · ${ROLE_LABEL[me.role]}`} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="Photo & details">
            <div className="flex flex-col gap-5">
              <AvatarForm name={me.name} avatarKey={me.avatarKey} />
              <ProfileForm name={me.name} phone={me.phone} />
            </div>
          </Panel>
          <Panel title="Password" description="Changing it signs you out on every other device.">
            <PasswordForm hasPassword={Boolean(me.hasPassword)} />
          </Panel>
        </div>
        <Panel title="Work details" description="Managed by an admin in Users & Roles.">
          <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-muted">Role</dt>
            <dd>{ROLE_LABEL[me.role]}</dd>
            <dt className="text-muted">Position</dt>
            <dd>{me.position ?? "—"}</dd>
            <dt className="text-muted">Department</dt>
            <dd>{me.department ?? "—"}</dd>
            <dt className="text-muted">Region</dt>
            <dd>{me.region ?? "—"}</dd>
            <dt className="text-muted">Reports to</dt>
            <dd>{me.manager ?? "—"}</dd>
            <dt className="text-muted">Joined</dt>
            <dd>{fdate(me.joinedOn)}</dd>
            <dt className="text-muted">Last sign-in</dt>
            <dd>{fdatetime(me.lastLoginAt)}</dd>
          </dl>
        </Panel>
      </div>
      <Panel
        title="Notifications"
        description="Choose where each notification reaches you."
        actions={
          <Link href="/notifications" className="btn">
            Phone & laptop alerts ({devices.n} {devices.n === 1 ? "device" : "devices"})
          </Link>
        }
      >
        <NotificationPrefsForm rows={rows} />
      </Panel>
    </>
  );
}
