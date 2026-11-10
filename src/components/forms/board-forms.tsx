"use client";

/** Boards & projects: create / edit, members, project status. */
import { archiveBoard, removeBoardMember, saveBoardMember, setProjectStatus, submitProject, createBoard, updateBoard } from "@/app/actions/boards";
import { BOARD_VISIBILITY } from "@/lib/labels";
import { ActionButton, ConfirmButton } from "./action-button";
import { CheckboxField, FormNote, SelectField, TextArea, TextField, type Option } from "./fields";
import { FormDialog } from "./form-dialog";

const fromDefs = (defs: Record<string, { label: string }>): Option[] => Object.entries(defs).map(([value, d]) => ({ value, label: d.label }));
const PRIORITY: Option[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
const DEP_MODE: Option[] = [
  { value: "flexible", label: "Flexible — warn when a date breaks a dependency" },
  { value: "strict", label: "Strict — block dates that break a dependency" },
  { value: "none", label: "None — dependencies are notes only" },
];

export type BoardFormOptions = { departments: Option[]; accounts: Option[]; deals: Option[]; defaultDepartmentId?: string };
export type BoardValues = {
  id: string;
  kind: "project" | "team" | "template";
  name: string;
  description: string | null;
  departmentId: string | null;
  visibility: string;
  priority: string | null;
  customerId: string | null;
  opportunityId: string | null;
  budget: number | null;
  actualCost: number | null;
  startOn: string | null;
  dueOn: string | null;
  dependencyMode: string;
};

function BoardFields({ project, o, b }: { project: boolean; o: BoardFormOptions; b?: BoardValues }) {
  return (
    <>
      <TextField name="name" label={project ? "Project name" : "Board name"} required wide defaultValue={b?.name} placeholder={project ? "e.g. Alas Harum — Amenities Rollout" : "e.g. Content Requests"} />
      <TextArea name="description" label="Description" wide rows={2} defaultValue={b?.description ?? ""} />
      <SelectField name="departmentId" label="Workspace (department)" options={o.departments} defaultValue={b?.departmentId ?? o.defaultDepartmentId} placeholder="No department" />
      <SelectField name="visibility" label="Who can see it" options={fromDefs(BOARD_VISIBILITY)} defaultValue={b?.visibility ?? "department"} hint="Private: members only. Everyone: all staff can view, members edit." />
      {project && (
        <>
          <SelectField name="priority" label="Priority" options={PRIORITY} defaultValue={b?.priority ?? "medium"} />
          <SelectField name="customerId" label="Account" options={o.accounts} defaultValue={b?.customerId ?? ""} placeholder="None" />
          <SelectField name="opportunityId" label="Deal" options={o.deals} defaultValue={b?.opportunityId ?? ""} placeholder="None" wide />
          <TextField name="budget" label="Budget (Rp)" inputMode="numeric" defaultValue={b?.budget ? String(b.budget) : ""} placeholder="e.g. 45.000.000" />
          <TextField name="actualCost" label="Actual cost (Rp)" inputMode="numeric" defaultValue={b?.actualCost ? String(b.actualCost) : ""} />
          <TextField name="startOn" label="Start" type="date" defaultValue={b?.startOn ?? ""} />
          <TextField name="dueOn" label="Due" type="date" defaultValue={b?.dueOn ?? ""} />
        </>
      )}
      <SelectField name="dependencyMode" label="Dependencies" options={DEP_MODE} defaultValue={b?.dependencyMode ?? "flexible"} wide />
    </>
  );
}

export function NewBoardButtons({ o }: { o: BoardFormOptions }) {
  return (
    <>
      <FormDialog trigger="+ Team board" triggerClassName="btn" title="New team board" description="A board for ongoing team work: requests, checklists, pipelines." action={createBoard} submitLabel="Create board" wide>
        <input type="hidden" name="kind" value="team" />
        <BoardFields project={false} o={o} />
      </FormDialog>
      <FormDialog trigger="+ Project" title="New project" description="Gets a project code (PRJ-YYYY-NNN) and starts as a draft — submit it for approval when the plan is ready." action={createBoard} submitLabel="Create project" wide>
        <input type="hidden" name="kind" value="project" />
        <BoardFields project o={o} />
      </FormDialog>
    </>
  );
}

export function EditBoardButton({ b, o }: { b: BoardValues; o: BoardFormOptions }) {
  return (
    <FormDialog trigger="Edit details" triggerClassName="btn" title={b.kind === "project" ? "Project details" : "Board details"} action={updateBoard} wide>
      <input type="hidden" name="id" value={b.id} />
      <BoardFields project={b.kind === "project"} o={o} b={b} />
    </FormDialog>
  );
}

export function ProjectStatusActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  if (!canManage) return null;
  if (status === "draft")
    return (
      <ActionButton action={submitProject} fields={{ id }} className="btn btn-primary">
        Submit for approval
      </ActionButton>
    );
  if (status === "pending_approval") return null;
  const next: { value: string; label: string }[] = [
    { value: "active", label: "Set active" },
    { value: "on_hold", label: "Put on hold" },
    { value: "completed", label: "Mark completed" },
    { value: "cancelled", label: "Cancel project" },
  ].filter((s) => s.value !== status);
  return (
    <>
      {next.map((s) => (
        <ActionButton key={s.value} action={setProjectStatus} fields={{ id, status: s.value }} className={`btn ${s.value === "cancelled" ? "text-bad" : ""}`}>
          {s.label}
        </ActionButton>
      ))}
    </>
  );
}

export function ArchiveBoardButton({ id, archived }: { id: string; archived: boolean }) {
  return archived ? (
    <ActionButton action={archiveBoard} fields={{ id }}>
      Restore board
    </ActionButton>
  ) : (
    <ConfirmButton action={archiveBoard} fields={{ id }} trigger="Archive" triggerClassName="btn" title="Archive this board?" submitLabel="Archive" danger={false}>
      The board becomes read-only and moves to Archived. You can restore it any time.
    </ConfirmButton>
  );
}

export type MemberRow = { userId: string; name: string; role: "owner" | "editor" | "viewer"; editAssignedOnly: boolean };

export function MembersButton({ boardId, members, people, canManage, ownerId }: { boardId: string; members: MemberRow[]; people: Option[]; canManage: boolean; ownerId: string | null }) {
  const label = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
  if (!canManage)
    return (
      <details className="relative">
        <summary className="btn list-none">Members · {members.length}</summary>
        <ul className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-line bg-surface p-2 text-[13px] shadow-panel">
          {members.map((m) => (
            <li key={m.userId} className="flex gap-2 px-1 py-1">
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="text-muted">{label[m.role]}</span>
            </li>
          ))}
        </ul>
      </details>
    );
  return (
    <FormDialog trigger={`Members · ${members.length}`} triggerClassName="btn" title="Board members" description="Owners manage the board; editors change items (optionally only the ones assigned to them); viewers look." action={saveBoardMember} submitLabel="Save member" stayOpen>
      <ul className="flex flex-col gap-1 sm:col-span-2">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px]">
            <span className="min-w-0 flex-1 truncate font-semibold">{m.name}</span>
            <span className="text-muted">
              {label[m.role]}
              {m.editAssignedOnly ? " · own items only" : ""}
            </span>
            {m.userId !== ownerId && (
              <ActionButton action={removeBoardMember} fields={{ boardId, userId: m.userId }} className="px-1 text-xs text-bad">
                Remove
              </ActionButton>
            )}
          </li>
        ))}
      </ul>
      <input type="hidden" name="boardId" value={boardId} />
          <SelectField name="userId" label="Person" required options={people} placeholder="Choose…" />
          <SelectField
            name="role"
            label="Role"
            options={[
              { value: "editor", label: "Editor" },
              { value: "viewer", label: "Viewer" },
              { value: "owner", label: "Owner" },
            ]}
            defaultValue="editor"
          />
          <CheckboxField name="editAssignedOnly" label="Editors: only items assigned to them" hint="Good for designers and freelancers on a shared project." />
          <FormNote>Picking someone who is already a member changes their role.</FormNote>
    </FormDialog>
  );
}
