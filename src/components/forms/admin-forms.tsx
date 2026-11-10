"use client";

import { createDepartment, deleteDepartment, updateDepartment } from "@/app/actions/departments";
import { decideApproval } from "@/app/actions/approvals";
import { createUser, resetUserPassword, setUserActive, updateUser } from "@/app/actions/users";
import { ROLE_LABEL, ROLE_ORDER } from "@/lib/roles";
import { ConfirmButton } from "./action-button";
import { FormNote, SelectField, TextArea, TextField, type Option } from "./fields";
import { FormDialog } from "./form-dialog";

const small = "btn px-2 py-1 text-xs";
const roleOptions: Option[] = ROLE_ORDER.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

/* ───────────── Users ───────────── */

export type UserValues = {
  id: string;
  name: string;
  email: string;
  role: string;
  departmentId: string | null;
  managerId: string | null;
  position: string | null;
  region: string | null;
  phone: string | null;
  joinedOn: string | null;
  active: boolean;
  hasPassword: boolean;
  google: boolean;
};

function UserFields({ u, departments, managers }: { u?: UserValues; departments: Option[]; managers: Option[] }) {
  return (
    <>
      <TextField name="name" label="Name" required defaultValue={u?.name} />
      <TextField name="email" label="Work email" type="email" required defaultValue={u?.email} />
      <SelectField name="role" label="Role" required options={roleOptions} defaultValue={u?.role ?? "staff"} />
      <SelectField name="departmentId" label="Department" options={departments} placeholder="None" defaultValue={u?.departmentId ?? undefined} />
      <SelectField name="managerId" label="Reports to" options={managers.filter((m) => m.value !== u?.id)} placeholder="Nobody" defaultValue={u?.managerId ?? undefined} />
      <TextField name="position" label="Position" defaultValue={u?.position ?? ""} />
      <TextField name="region" label="Region" defaultValue={u?.region ?? ""} />
      <TextField name="phone" label="Phone" type="tel" inputMode="tel" defaultValue={u?.phone ?? ""} />
      <TextField name="joinedOn" label="Joined on" type="date" defaultValue={u?.joinedOn ?? ""} />
    </>
  );
}

export function NewUserButton({ departments, managers }: { departments: Option[]; managers: Option[] }) {
  return (
    <FormDialog trigger="+ User" title="New user" description="A temporary password is emailed; they choose their own at first sign-in." action={createUser} submitLabel="Create user" wide stayOpen>
      <UserFields departments={departments} managers={managers} />
    </FormDialog>
  );
}

export function UserRowActions({ u, departments, managers, self }: { u: UserValues; departments: Option[]; managers: Option[]; self: boolean }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <FormDialog trigger="Edit" triggerClassName={small} title={`Edit ${u.name}`} action={updateUser} wide>
        <input type="hidden" name="id" value={u.id} />
        <UserFields u={u} departments={departments} managers={managers} />
        {self && <FormNote tone="warn">You can&apos;t change your own role.</FormNote>}
      </FormDialog>
      {!self && !u.google && u.active && (
        <FormDialog trigger="Reset password" triggerClassName={small} title={`Reset ${u.name}'s password?`} action={resetUserPassword} submitLabel="Reset password" stayOpen>
          <input type="hidden" name="id" value={u.id} />
          <FormNote>A new temporary password is emailed and shown here once. {u.name} is signed out everywhere and must choose a new password at the next sign-in.</FormNote>
        </FormDialog>
      )}
      {!self &&
        (u.active ? (
          <ConfirmButton action={setUserActive} fields={{ id: u.id, active: "false" }} trigger="Deactivate" triggerClassName={`${small} text-bad`} title={`Deactivate ${u.name}?`} submitLabel="Deactivate">
            They&apos;re signed out at once and can&apos;t sign in. Their records stay as they are.
          </ConfirmButton>
        ) : (
          <FormDialog trigger={u.hasPassword || u.google ? "Activate" : "Activate & invite"} triggerClassName={`${small} text-ok`} title={`Activate ${u.name}?`} action={setUserActive} submitLabel="Activate" stayOpen>
            <input type="hidden" name="id" value={u.id} />
            <input type="hidden" name="active" value="true" />
            <FormNote>{u.hasPassword || u.google ? `${u.name} can sign in again with their existing password.` : `${u.name} has no password yet (imported). A temporary password is emailed and shown here once.`}</FormNote>
          </FormDialog>
        ))}
    </div>
  );
}

/* ───────────── Departments ───────────── */

export type DepartmentValues = { id: string; name: string; code: string; headUserId: string | null; parentId: string | null };

function DepartmentFields({ d, people, departments }: { d?: DepartmentValues; people: Option[]; departments: Option[] }) {
  return (
    <>
      <TextField name="name" label="Name" required defaultValue={d?.name} />
      <TextField name="code" label="Code" required defaultValue={d?.code} placeholder="SALES" hint="Short, unique." />
      <SelectField name="headUserId" label="Head" options={people} placeholder="Nobody yet" defaultValue={d?.headUserId ?? undefined} hint="Gets approval steps for “Head of department”." />
      <SelectField name="parentId" label="Part of" options={departments.filter((x) => x.value !== d?.id)} placeholder="Top level" defaultValue={d?.parentId ?? undefined} />
    </>
  );
}

export function NewDepartmentButton({ people, departments }: { people: Option[]; departments: Option[] }) {
  return (
    <FormDialog trigger="+ Department" title="New department" action={createDepartment} submitLabel="Add department" wide>
      <DepartmentFields people={people} departments={departments} />
    </FormDialog>
  );
}

export function DepartmentRowActions({ d, people, departments }: { d: DepartmentValues; people: Option[]; departments: Option[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <FormDialog trigger="Edit" triggerClassName={small} title={`Edit ${d.name}`} action={updateDepartment} wide>
        <input type="hidden" name="id" value={d.id} />
        <DepartmentFields d={d} people={people} departments={departments} />
      </FormDialog>
      <ConfirmButton action={deleteDepartment} fields={{ id: d.id }} trigger="Delete" triggerClassName={`${small} text-bad`} title={`Delete ${d.name}?`}>
        Only empty departments (no people, no sub-departments) can be deleted.
      </ConfirmButton>
    </div>
  );
}

/* ───────────── Approval inbox ───────────── */

export function ApprovalDecision({ requestId, title }: { requestId: string; title: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <FormDialog trigger="Approve" triggerClassName={`${small} border-ok text-ok`} title={`Approve: ${title}`} action={decideApproval} submitLabel="Approve">
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="decision" value="approved" />
        <TextArea name="note" label="Note (optional)" rows={2} />
      </FormDialog>
      <FormDialog trigger="Reject" triggerClassName={`${small} text-bad`} title={`Reject: ${title}`} action={decideApproval} submitLabel="Reject" danger>
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="decision" value="rejected" />
        <TextArea name="note" label="Reason" required rows={2} />
      </FormDialog>
    </div>
  );
}
