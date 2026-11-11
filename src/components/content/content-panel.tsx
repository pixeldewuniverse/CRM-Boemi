"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { addContentComment, deleteContent, loadContentDetail, moveContent, removeContentAsset, uploadContentAsset, type ContentDetail } from "@/app/actions/content";
import { CONTENT_STATUS } from "@/lib/labels";
import { MAX_CONTENT_FILE_MB, type ContentStep } from "@/lib/content-flow";
import { StatusPill } from "@/components/ui/pill";
import { FormDialog } from "@/components/forms/form-dialog";
import { EditBriefButton, type BriefOptions } from "./brief-form";

type Detail = NonNullable<ContentDetail>;
type Asset = Detail["assets"][number];
type Tab = "brief" | "design" | "activity";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const kb = (n: number | null) => (n == null ? "" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const src = (a: Asset) => (a.fileKey ? `/api/files/${a.fileKey}` : (a.url ?? "#"));

function Preview({ a }: { a: Asset }) {
  if (a.fileKey && a.mime?.startsWith("image/")) {
    return (
      <a href={src(a)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- private file behind /api/files */}
        <img src={src(a)} alt={a.name} className="max-h-72 w-full object-contain" loading="lazy" />
      </a>
    );
  }
  if (a.fileKey && a.mime === "video/mp4") return <video src={src(a)} controls preload="metadata" className="max-h-72 w-full rounded-lg border border-line bg-black" />;
  return null;
}

function AssetRow({ a, canRemove, onRemove }: { a: Asset; canRemove: boolean; onRemove: (a: Asset) => void }) {
  return (
    <li className="flex flex-col gap-1.5">
      <Preview a={a} />
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className="grid size-7 flex-none place-items-center rounded-md bg-surface-2 text-[10px] font-bold uppercase text-muted">{a.url ? "link" : (a.mime?.split("/")[1] ?? "file").replace("jpeg", "jpg")}</span>
        <a href={src(a)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold text-accent hover:underline">
          {a.name}
        </a>
        <span className="flex-none text-xs text-muted">{[kb(a.size), a.by, when(a.at)].filter(Boolean).join(" · ")}</span>
        {canRemove && (
          <button type="button" className="btn flex-none px-1.5 py-0.5 text-xs" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a)}>
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

function Uploader({ contentId, kind, label, onDone }: { contentId: string; kind: "design" | "reference"; label: string; onDone: () => void }) {
  const [mode, setMode] = useState<"file" | "link">("file");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="flex flex-col gap-2 rounded-lg border border-dashed border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await uploadContentAsset(fd);
          if (!r.ok) return setError(r.error);
          setError(null);
          form.current?.reset();
          onDone();
        });
      }}
    >
      <input type="hidden" name="contentId" value={contentId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">{label}</span>
        <div role="radiogroup" aria-label="Upload type" className="ml-auto flex rounded-lg border border-line p-0.5 text-xs">
          {(["file", "link"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded-md px-2 py-0.5 ${mode === m ? "bg-accent-soft font-semibold text-accent" : "text-muted"}`}>
              {m === "file" ? "File" : "Link"}
            </button>
          ))}
        </div>
      </div>
      {mode === "file" ? (
        <input name="file" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4" aria-label={`${label} file`} className="text-[13px] file:btn file:mr-2 file:px-2 file:py-1" />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <input name="url" type="url" required placeholder="https://www.canva.com/…" aria-label="Link" className="input" />
          <input name="name" type="text" placeholder="Name (optional)" aria-label="Link name" className="input" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-muted">{mode === "file" ? `JPG, PNG, WebP, PDF or MP4 up to ${MAX_CONTENT_FILE_MB} MB.` : "For larger files: Canva, Google Drive, Figma…"}</p>
        <button type="submit" className="btn btn-primary px-2.5 py-1 text-[13px]" disabled={pending}>
          {pending ? "Uploading…" : "Add"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </form>
  );
}

function Steps({ id, title, steps, onDone }: { id: string; title: string; steps: ContentStep[]; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!steps.length) return null;
  const run = (to: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("contentId", id);
      fd.set("to", to);
      const r = await moveContent({}, fd);
      if (!r.ok) return setError(r.error ?? "Not saved.");
      setError(null);
      onDone();
    });
  const after = async (r: { ok?: boolean }) => {
    if (r.ok) onDone();
    return r;
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((s) =>
          s.needsNote ? (
            <FormDialog key={s.to} trigger={s.label} triggerClassName="btn px-2.5 py-1 text-[13px] text-bad" title={`${s.label}: ${title}`} action={async (p, fd) => after(await moveContent(p, fd))} submitLabel="Send to designer">
              <input type="hidden" name="contentId" value={id} />
              <input type="hidden" name="to" value={s.to} />
              <label className="flex flex-col gap-1 text-[13px] font-semibold">
                What should change?<span className="sr-only"> (required)</span>
                <textarea name="note" required rows={4} className="input font-normal" />
              </label>
            </FormDialog>
          ) : s.to === "published" ? (
            <FormDialog key={s.to} trigger={s.label} triggerClassName="btn btn-primary px-2.5 py-1 text-[13px]" title={`${s.label}: ${title}`} action={async (p, fd) => after(await moveContent(p, fd))} submitLabel="Mark published">
              <input type="hidden" name="contentId" value={id} />
              <input type="hidden" name="to" value={s.to} />
              <label className="flex flex-col gap-1 text-[13px] font-semibold">
                Link to the live post (optional)
                <input name="publishedUrl" type="url" placeholder="https://www.instagram.com/p/…" className="input font-normal" />
              </label>
            </FormDialog>
          ) : (
            <button key={s.to} type="button" disabled={pending} onClick={() => run(s.to)} className={`btn px-2.5 py-1 text-[13px] ${s.to === "approved" ? "border-ok text-ok" : "btn-primary"}`}>
              {s.label}
            </button>
          ),
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

const ACT: Record<string, string> = { created: "created the brief", edited: "edited", rescheduled: "moved the date", upload: "added", removed: "removed", comment: "" };

/** Side panel for one post: brief, design versions, review steps and the activity / comment thread. */
export function ContentPanel({ id, options, people, onClose }: { id: string; options: BriefOptions; people: Record<string, string>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [d, setD] = useState<Detail | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("brief");
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reload = useCallback(() => {
    loadContentDetail(id).then((r) => setD(r));
  }, [id]);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    let live = true;
    loadContentDetail(id).then((r) => {
      if (!live) return;
      setD(r);
      if (r && (r.can.upload || ["in_review", "revision"].includes(r.item.status))) setTab("design");
    });
    return () => {
      live = false;
    };
  }, [id]);

  const remove = (a: Asset) =>
    start(async () => {
      const r = await removeContentAsset({ assetId: a.id });
      setMsg(r.ok ? null : r.error);
      reload();
    });
  const send = () =>
    start(async () => {
      const r = await addContentComment({ contentId: id, body: comment });
      if (!r.ok) return setMsg(r.error);
      setMsg(null);
      setComment("");
      reload();
    });

  const designs = d?.assets.filter((a) => a.kind === "design") ?? [];
  const refs = d?.assets.filter((a) => a.kind === "reference") ?? [];
  const versions = [...new Set(designs.map((a) => a.version))].sort((a, b) => b - a);
  const current = d ? Math.max(1, d.item.designVersion) : 1;
  const lastRevision = d?.activity.find((a) => a.type === "status" && a.to === "revision" && a.body);

  return (
    <dialog
      ref={ref}
      // React bubbles "close" from the dialogs inside (Edit brief, Request revision) — only react to our own.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      aria-label={d?.item.title ?? "Content"}
      className="fixed inset-y-0 right-0 m-0 ml-auto h-dvh max-h-dvh w-full max-w-[34rem] overflow-y-auto border-l border-line bg-surface p-0 text-fg shadow-panel backdrop:bg-black/30"
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-snug">{d?.item.title ?? (d === null ? "Not found" : "Loading…")}</h2>
            {d && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                <StatusPill map={CONTENT_STATUS} value={d.item.status} />
                <span>
                  {dayLabel(d.item.date)} · {d.item.time} WIB
                </span>
                <span>
                  {d.item.channels.join(" · ")} · {d.item.format}
                </span>
              </p>
            )}
          </div>
          <button type="button" className="btn px-2 py-1" onClick={() => ref.current?.close()} aria-label="Close">
            ✕
          </button>
        </div>
        {d === null && <p className="text-[13px] text-muted">This post was deleted or you can no longer see it.</p>}
        {d && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Steps id={d.item.id} title={d.item.title} steps={d.can.steps} onDone={reload} />
              <span className="ml-auto flex gap-1.5">
                {d.can.edit && <EditBriefButton v={d.item} options={options} onSaved={reload} />}
                {d.can.delete && (
                  <FormDialog trigger="Delete" triggerClassName="btn px-2.5 py-1 text-[13px] text-bad" title={`Delete “${d.item.title}”?`} description="The brief, its files and its history are removed." action={async (p, fd) => { const r = await deleteContent(p, fd); if (r.ok) ref.current?.close(); return r; }} submitLabel="Delete" danger>
                    <input type="hidden" name="id" value={d.item.id} />
                  </FormDialog>
                )}
              </span>
            </div>
            {d.item.status === "revision" && lastRevision && (
              <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px]">
                <span className="font-semibold text-bad">Revision requested</span> by {lastRevision.by ?? "someone"}: {lastRevision.body}
              </p>
            )}
            {d.item.publishedUrl && (
              <a href={d.item.publishedUrl} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-accent hover:underline">
                View the live post ↗
              </a>
            )}

            <div role="tablist" aria-label="Post details" className="flex gap-1 border-b border-line">
              {(
                [
                  ["brief", "Brief"],
                  ["design", `Design${designs.length ? ` · v${versions[0]}` : ""}`],
                  ["activity", `Activity${d.activity.length ? ` · ${d.activity.length}` : ""}`],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] font-semibold ${tab === k ? "border-accent text-accent" : "border-transparent text-muted"}`}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "brief" && (
              <div role="tabpanel" className="flex flex-col gap-3">
                <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1.5 text-[13px]">
                  {(
                    [
                      ["Writer", d.item.writerId ? people[d.item.writerId] : null],
                      ["Designer", d.item.designerId ? people[d.item.designerId] : null],
                      ["Campaign", options.campaigns.find((o) => o.value === d.item.campaignId)?.label],
                      ["Objective", d.item.objective],
                      ["Key message", d.item.keyMessage],
                      ["Guideline", d.item.guideline],
                      ["Caption", d.item.caption],
                      ["CTA", d.item.cta],
                      ["Products", d.item.products],
                      ["Hashtags", d.item.hashtags],
                    ] as [string, string | null | undefined][]
                  ).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted">{k}</dt>
                      <dd className="min-w-0 whitespace-pre-line break-words">{v || <span className="text-muted">—</span>}</dd>
                    </div>
                  ))}
                </dl>
                <section className="flex flex-col gap-2">
                  <h3 className="font-bold">References</h3>
                  {refs.length ? (
                    <ul className="flex flex-col gap-3">
                      {refs.map((a) => (
                        <AssetRow key={a.id} a={a} canRemove={d.can.edit} onRemove={remove} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-muted">No reference files or links.</p>
                  )}
                  {d.can.edit && <Uploader contentId={d.item.id} kind="reference" label="Add a reference" onDone={reload} />}
                </section>
              </div>
            )}

            {tab === "design" && (
              <div role="tabpanel" className="flex flex-col gap-3">
                {d.can.upload && <Uploader contentId={d.item.id} kind="design" label={`Upload design v${current}`} onDone={reload} />}
                {!designs.length && <p className="text-[13px] text-muted">{d.item.designerId ? `No design yet — ${people[d.item.designerId] ?? "the designer"} uploads it here.` : "No designer assigned yet."}</p>}
                {versions.map((ver) => (
                  <details key={ver} open={ver === versions[0]} className="rounded-lg border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-[13px] font-bold">
                      Version {ver}
                      {ver === versions[0] ? " · latest" : ""}
                    </summary>
                    <ul className="flex flex-col gap-3 px-3 pb-3">
                      {designs
                        .filter((a) => a.version === ver)
                        .map((a) => (
                          <AssetRow key={a.id} a={a} canRemove={d.can.upload && ver === current} onRemove={remove} />
                        ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}

            {tab === "activity" && (
              <div role="tabpanel" className="flex flex-col gap-3">
                {d.can.comment && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="content-comment" className="text-[13px] font-semibold">
                      Comment
                    </label>
                    <textarea id="content-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} className="input" placeholder="Feedback, questions, notes for the team…" />
                    <button type="button" className="btn btn-primary self-end px-2.5 py-1 text-[13px]" disabled={pending || !comment.trim()} onClick={send}>
                      Post comment
                    </button>
                  </div>
                )}
                <ol className="flex flex-col gap-2">
                  {d.activity.map((a) => (
                    <li key={a.id} className={`text-[13px] ${a.type === "comment" ? "rounded-lg bg-surface-2 px-3 py-2" : ""}`}>
                      <p>
                        <span className="font-semibold">{a.by ?? "Someone"}</span>{" "}
                        {a.type === "status" ? (
                          <>
                            moved it to <StatusPill map={CONTENT_STATUS} value={a.to} />
                          </>
                        ) : (
                          ACT[a.type] ?? a.type
                        )}{" "}
                        {a.type !== "comment" && a.type !== "status" && a.body && <span className="text-muted">{a.body}</span>}
                        <span className="ml-1 text-xs text-muted">{when(a.at)}</span>
                      </p>
                      {(a.type === "comment" || (a.type === "status" && a.body)) && <p className="mt-0.5 whitespace-pre-line break-words">{a.body}</p>}
                    </li>
                  ))}
                  {!d.activity.length && <li className="text-[13px] text-muted">No activity yet.</li>}
                </ol>
              </div>
            )}
            {msg && (
              <p role="alert" className="text-[13px] text-bad">
                {msg}
              </p>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
