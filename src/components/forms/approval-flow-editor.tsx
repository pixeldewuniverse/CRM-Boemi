"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useState, useTransition } from "react";
import { deleteApprovalFlow, saveApprovalFlow, testApprovalFlow, type SimulationResult } from "@/app/actions/approval-flows";
import { ROLE_LABEL, ROLE_ORDER, type Role } from "@/lib/roles";
import { ConfirmButton } from "./action-button";
import { CheckboxField, SelectField, TextField, type Option } from "./fields";
import { FormDialog, useFormErrors } from "./form-dialog";

export type StepValue = { approverType: string; roles: string[]; userId: string | null; label: string | null };
export type FlowValue = { id: string; entityType: string; name: string; active: boolean; minAmount: number | null; maxAmount: number | null; priority: number; steps: StepValue[] };

const TYPES: Option[] = [
  { value: "role", label: "Anyone with role" },
  { value: "user", label: "A specific person" },
  { value: "direct_manager", label: "Requester's direct manager" },
  { value: "department_head", label: "Head of requester's department" },
];
let seq = 0;
const key = () => `s${++seq}`;

function SortableStep({
  step,
  index,
  people,
  onChange,
  onRemove,
  canRemove,
}: {
  step: StepValue & { key: string };
  index: number;
  people: Option[];
  onChange: (patch: Partial<StepValue>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.key });
  const id = useId();
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`rounded-lg border border-line bg-surface p-3 ${isDragging ? "z-10 shadow-panel" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" {...attributes} {...listeners} aria-label={`Move step ${index + 1}`} className="cursor-grab touch-none rounded-md px-1.5 py-1 text-muted hover:bg-surface-2 active:cursor-grabbing">
          ⠿
        </button>
        <span className="mr-auto text-[13px] font-semibold sm:mr-0">Step {index + 1}</span>
        <select aria-label={`Step ${index + 1} approver`} value={step.approverType} onChange={(e) => onChange({ approverType: e.target.value })} className="input order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={onRemove} disabled={!canRemove} className="btn px-2 py-1 text-xs text-bad" aria-label={`Remove step ${index + 1}`}>
          Remove
        </button>
      </div>
      {step.approverType === "role" && (
        <fieldset className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <legend className="sr-only">Roles for step {index + 1}</legend>
          {ROLE_ORDER.map((r) => (
            <label key={r} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={step.roles.includes(r)}
                onChange={(e) => onChange({ roles: e.target.checked ? [...step.roles, r] : step.roles.filter((x) => x !== r) })}
                className="size-4 accent-[var(--accent)]"
              />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </fieldset>
      )}
      {step.approverType === "user" && (
        <select aria-label={`Step ${index + 1} person`} value={step.userId ?? ""} onChange={(e) => onChange({ userId: e.target.value || null })} className="input mt-2">
          <option value="">Choose a person…</option>
          {people.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      <label htmlFor={`${id}-label`} className="sr-only">
        Step {index + 1} name
      </label>
      <input id={`${id}-label`} value={step.label ?? ""} onChange={(e) => onChange({ label: e.target.value || null })} placeholder="Name shown to people (optional), e.g. Finance check" className="input mt-2" maxLength={80} />
    </li>
  );
}

function StepsEditor({ initial, people }: { initial: StepValue[]; people: Option[] }) {
  const errors = useFormErrors().fieldErrors ?? {};
  const [steps, setSteps] = useState(() => (initial.length ? initial : [{ approverType: "direct_manager", roles: [], userId: null, label: null }]).map((s) => ({ ...s, key: key() })));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setSteps((s) => arrayMove(s, s.findIndex((x) => x.key === e.active.id), s.findIndex((x) => x.key === e.over!.id)));
  };
  const clean = steps.map(({ approverType, roles, userId, label }) => ({ approverType, roles, userId, label }));
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <input type="hidden" name="steps" value={JSON.stringify(clean)} />
      <h3 className="text-[13px] font-semibold">Steps (in order — drag ⠿ to reorder)</h3>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={steps.map((s) => s.key)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-2">
            {steps.map((s, i) => (
              <SortableStep
                key={s.key}
                step={s}
                index={i}
                people={people}
                canRemove={steps.length > 1}
                onChange={(patch) => setSteps((all) => all.map((x) => (x.key === s.key ? { ...x, ...patch } : x)))}
                onRemove={() => setSteps((all) => all.filter((x) => x.key !== s.key))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {errors.steps && <p className="text-xs text-bad">{errors.steps}</p>}
      <button type="button" className="btn self-start" disabled={steps.length >= 6} onClick={() => setSteps((s) => [...s, { approverType: "role", roles: ["finance"], userId: null, label: null, key: key() }])}>
        + Add step
      </button>
      <p className="text-xs text-muted">The requester never approves their own request. If a step finds nobody (e.g. no manager set), it goes to Super Admins.</p>
    </div>
  );
}

function FlowFields({ f, entities, people }: { f?: FlowValue; entities: Option[]; people: Option[] }) {
  return (
    <>
      <TextField name="name" label="Name" required defaultValue={f?.name} wide />
      <SelectField name="entityType" label="Request type" required options={entities} defaultValue={f?.entityType ?? "visit_fee"} />
      <TextField name="priority" label="Priority" inputMode="numeric" defaultValue={String(f?.priority ?? 100)} hint="Lower number wins when ranges overlap." />
      <TextField name="minAmount" label="From amount" inputMode="numeric" defaultValue={f?.minAmount != null ? String(f.minAmount) : ""} hint="Rupiah, or % for quotation discounts. Empty = no minimum." />
      <TextField name="maxAmount" label="Up to amount" inputMode="numeric" defaultValue={f?.maxAmount != null ? String(f.maxAmount) : ""} hint="Empty = no maximum." />
      <CheckboxField name="active" label="Active" defaultChecked={f?.active ?? true} />
      <StepsEditor initial={f?.steps ?? []} people={people} />
    </>
  );
}

export function NewFlowButton({ entities, people }: { entities: Option[]; people: Option[] }) {
  return (
    <FormDialog trigger="+ Workflow" title="New approval workflow" action={saveApprovalFlow} submitLabel="Save workflow" size="xl">
      <FlowFields entities={entities} people={people} />
    </FormDialog>
  );
}

export function FlowRowActions({ f, entities, people }: { f: FlowValue; entities: Option[]; people: Option[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <FormDialog trigger="Edit" triggerClassName="btn px-2 py-1 text-xs" title={`Edit ${f.name}`} description="Requests already in progress keep the steps they started with." action={saveApprovalFlow} submitLabel="Save workflow" size="xl">
        <input type="hidden" name="id" value={f.id} />
        <FlowFields f={f} entities={entities} people={people} />
      </FormDialog>
      <ConfirmButton action={deleteApprovalFlow} fields={{ id: f.id }} trigger="Delete" triggerClassName="btn px-2 py-1 text-xs text-bad" title={`Delete ${f.name}?`}>
        Without an active workflow for a request type, those requests are approved automatically. Workflows still in use can&apos;t be deleted — deactivate them.
      </ConfirmButton>
    </div>
  );
}

/** "Who approves amount X for this person?" */
export function FlowTester({ entities, people }: { entities: Option[]; people: Option[] }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<SimulationResult | undefined>();
  const [form, setForm] = useState({ entityType: entities[0]?.value ?? "visit_fee", amount: "150000", requesterId: people[0]?.value ?? "" });
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_10rem_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => setRes(await testApprovalFlow(form)));
        }}
      >
        <label htmlFor={`${id}-t`} className="flex flex-col gap-1 text-[13px] font-semibold">
          Request type
          <select id={`${id}-t`} className="input font-normal" value={form.entityType} onChange={(e) => setForm({ ...form, entityType: e.target.value })}>
            {entities.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-a`} className="flex flex-col gap-1 text-[13px] font-semibold">
          Amount
          <input id={`${id}-a`} className="input font-normal" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </label>
        <label htmlFor={`${id}-r`} className="flex flex-col gap-1 text-[13px] font-semibold">
          Requested by
          <select id={`${id}-r`} className="input font-normal" value={form.requesterId} onChange={(e) => setForm({ ...form, requesterId: e.target.value })}>
            {people.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary justify-center" disabled={pending}>
          {pending ? "Checking…" : "Who approves?"}
        </button>
      </form>
      {res === null && <p className="text-[13px] text-muted">No active workflow matches — this request would be approved automatically.</p>}
      {res && "error" in res && <p className="text-[13px] text-bad">{res.error}</p>}
      {res && "flow" in res && (
        <div role="status" className="rounded-lg border border-line p-3 text-[13px]">
          <p className="font-semibold">Workflow: {res.flow.name}</p>
          <ol className="mt-2 flex flex-col gap-1">
            {res.steps.map((s) => (
              <li key={s.position}>
                <span className="font-semibold">
                  {s.position}. {s.label}
                </span>{" "}
                → {s.approvers.length ? s.approvers.join(", ") : "nobody"}
                {s.fallback && <span className="text-warn"> (nobody matched — goes to Super Admin)</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export const roleName = (r: string) => ROLE_LABEL[r as Role] ?? r;
