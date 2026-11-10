"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { commitImport, previewImport, type CommitImportResult, type PreviewResult } from "@/app/actions/import";
import { IMPORT_FIELDS, IMPORT_LABEL, type ImportEntity } from "@/lib/import/fields";
import type { Option } from "./fields";

const MAX_BYTES = 5 * 1024 * 1024;
const DELIMITER: Record<string, string> = { ",": "comma", ";": "semicolon", "\t": "tab" };
const STATUS = {
  new: { label: "New", cls: "bg-ok-soft text-ok" },
  duplicate: { label: "Duplicate", cls: "bg-warn-soft text-warn" },
  error: { label: "Error", cls: "bg-bad-soft text-bad" },
} as const;

/** Reads the file as text: UTF-8 (BOM removed later on the server), Windows-1252 as a fallback. */
async function readText(file: File): Promise<{ text: string; note?: string } | { error: string }> {
  if (file.size > MAX_BYTES) return { error: "The file is larger than 5 MB. Split it into smaller files." };
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) return { error: "This is an Excel workbook. In Excel choose File → Save As → “CSV UTF-8 (comma delimited)”, then upload the .csv file." };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf) };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(buf), note: "The file isn't UTF-8; it was read as Windows-1252 (older Excel). Check accented letters in the preview." };
  }
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportButton({ entity, owners = [], disabled }: { entity: ImportEntity; owners?: Option[]; disabled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string; note?: string } | null>(null);
  const [mapping, setMapping] = useState<Record<string, number> | undefined>();
  const [ownerId, setOwnerId] = useState("");
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [filter, setFilter] = useState<"all" | "new" | "duplicate" | "error">("all");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<CommitImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fields = IMPORT_FIELDS[entity];
  const label = IMPORT_LABEL[entity];
  const step = result?.ok ? 3 : file ? 2 : 1;

  const reset = () => {
    setFile(null);
    setMapping(undefined);
    setPreview(null);
    setResult(null);
    setError(null);
    setFilter("all");
    setMode("skip");
    if (fileInput.current) fileInput.current.value = "";
  };

  const runPreview = (f: { name: string; text: string }, m?: Record<string, number>, owner = ownerId) =>
    start(async () => {
      const res = await previewImport({ entity, fileName: f.name, text: f.text, mapping: m, ownerId: owner || undefined });
      setPreview(res);
      if (res.mapping) setMapping(res.mapping);
      setError(res.ok ? null : res.error);
    });

  const onFile = async (f: File | undefined) => {
    setResult(null);
    setPreview(null);
    if (!f) return;
    const read = await readText(f);
    if ("error" in read) {
      setError(read.error);
      return;
    }
    const next = { name: f.name, ...read };
    setFile(next);
    setMapping(undefined);
    runPreview(next);
  };

  const onCommit = () =>
    file &&
    start(async () => {
      const res = await commitImport({ entity, fileName: file.name, text: file.text, mapping, ownerId: ownerId || undefined, mode });
      setResult(res);
      setError(res.ok ? null : res.error);
    });

  const ok = preview?.ok ? preview : null;
  const headers = preview?.headers ?? [];
  const shown = useMemo(() => (ok ? ok.rows.filter((r) => filter === "all" || r.status === filter) : []), [ok, filter]);
  const toWrite = ok ? ok.counts.new + (mode === "update" ? ok.counts.updatable : 0) : 0;
  const cols = fields.filter((f) => (mapping?.[f.key] ?? -1) >= 0).slice(0, 4);

  return (
    <>
      <button type="button" className="btn" disabled={disabled} onClick={() => dialog.current?.showModal()}>
        Import CSV
      </button>
      <dialog
        ref={dialog}
        aria-label={`Import ${label}`}
        className="m-auto max-h-[92dvh] w-[min(96vw,60rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-fg shadow-panel backdrop:bg-black/40"
        onClose={reset}
      >
        <div className="flex flex-col gap-4 p-5">
          <header className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">Import {label.toLowerCase()}</h2>
              <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-label="Steps">
                {["Upload", "Check & map", "Done"].map((s, i) => (
                  <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={step === i + 1 ? "font-semibold text-accent" : ""}>
                    {i + 1}. {s}
                  </li>
                ))}
              </ol>
            </div>
            <a href={`/api/import/template/${entity}`} className="text-[13px] font-semibold text-accent hover:underline">
              Download template
            </a>
          </header>

          {/* Step 1 */}
          {step < 3 && (
            <div className="rounded-lg border border-dashed border-line p-4">
              <label className="flex flex-col gap-2 text-[13px]">
                <span className="font-semibold">CSV file</span>
                <input ref={fileInput} type="file" accept=".csv,.txt,text/csv" className="text-[13px] file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-fg" onChange={(e) => onFile(e.target.files?.[0])} />
                <span className="text-xs text-muted">
                  Max 5 MB and 5,000 rows. Comma or semicolon separated, UTF-8. From Excel: File → Save As → CSV UTF-8. First row = column names.
                </span>
              </label>
              {file && (
                <p className="mt-2 text-xs text-muted">
                  <span className="font-semibold text-fg">{file.name}</span>
                  {ok && ` · ${ok.total.toLocaleString("en-US")} rows · ${DELIMITER[ok.delimiter] ?? ok.delimiter} separated`}
                </p>
              )}
              {file?.note && <p className="mt-1 text-xs text-warn">{file.note}</p>}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
              {error}
            </p>
          )}
          {pending && (
            <p role="status" className="text-[13px] text-muted">
              {step === 2 && !result ? "Checking rows…" : "Working…"}
            </p>
          )}

          {/* Step 2: mapping */}
          {step === 2 && headers.length > 0 && (
            <section aria-label="Column mapping" className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold">Columns</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {fields.map((f) => (
                  <label key={f.key} className="flex min-w-0 flex-col gap-1 text-[13px]">
                    <span>
                      {f.label}
                      {f.required && <span className="text-bad"> *</span>}
                      {f.hint && <span className="ml-1 text-xs text-muted">· {f.hint}</span>}
                    </span>
                    <select
                      className={`input ${preview && !preview.ok && preview.missing?.includes(f.label) ? "border-bad" : ""}`}
                      value={mapping?.[f.key] ?? -1}
                      onChange={(e) => {
                        const next = { ...(mapping ?? {}), [f.key]: Number(e.target.value) };
                        setMapping(next);
                        if (file) runPreview(file, next);
                      }}
                    >
                      <option value={-1}>— not in file —</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          )}

          {/* Step 2: preview */}
          {step === 2 && ok && (
            <section aria-label="Preview" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {(["all", "new", "duplicate", "error"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilter(s)}
                    aria-pressed={filter === s}
                    className={`rounded-full border px-3 py-1 text-[13px] font-semibold ${filter === s ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}
                  >
                    {s === "all" ? "All" : s === "new" ? "Valid" : s === "duplicate" ? "Duplicates" : "Errors"}{" "}
                    <span className="tabular-nums opacity-70">{s === "all" ? ok.total : ok.counts[s]}</span>
                  </button>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {ok.counts.duplicate > 0 && (
                  <fieldset className="rounded-lg border border-line p-3 text-[13px]">
                    <legend className="px-1 font-semibold">Duplicates ({ok.counts.duplicate})</legend>
                    <label className="flex items-center gap-2">
                      <input type="radio" name={`mode-${entity}`} checked={mode === "skip"} onChange={() => setMode("skip")} className="accent-[var(--accent)]" /> Skip them
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name={`mode-${entity}`} checked={mode === "update"} onChange={() => setMode("update")} disabled={!ok.counts.updatable} className="accent-[var(--accent)]" />
                      Update existing records ({ok.counts.updatable})
                    </label>
                    <p className="mt-1 text-xs text-muted">Update only fills in cells that have a value — empty cells never erase data. Duplicates inside the file are always skipped.</p>
                  </fieldset>
                )}
                {owners.length > 0 && (
                  <label className="flex flex-col gap-1 text-[13px]">
                    <span className="font-semibold">Default owner</span>
                    <select
                      className="input"
                      value={ownerId}
                      onChange={(e) => {
                        setOwnerId(e.target.value);
                        if (file) runPreview(file, mapping, e.target.value);
                      }}
                    >
                      <option value="">Me</option>
                      {owners.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted">Used when the Owner email column is empty. Source is set to “Import”.</span>
                  </label>
                )}
              </div>

              <div className="max-h-[22rem] overflow-auto rounded-lg border border-line">
                <table className="tbl min-w-[640px] text-[13px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr>
                      <th className="num">Row</th>
                      <th>Result</th>
                      {cols.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.line}>
                        <td className="num text-muted">{r.line}</td>
                        <td className="min-w-48">
                          <span className={`pill ${STATUS[r.status].cls}`}>{r.status === "duplicate" && mode === "update" && r.updatable ? "Update" : STATUS[r.status].label}</span>
                          {r.message && <p className="mt-1 text-xs text-muted">{r.message}</p>}
                        </td>
                        {cols.map((c) => (
                          <td key={c.key} className="max-w-48 truncate" title={r.values[c.key]}>
                            {r.values[c.key] || <span className="text-muted">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={cols.length + 2} className="py-6 text-center text-muted">
                          No rows here.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {ok.total > ok.rows.length && <p className="text-xs text-muted">Showing up to 200 rows per result. All rows are checked and imported.</p>}
            </section>
          )}

          {/* Step 3 */}
          {result?.ok && (
            <section aria-label="Result" className="flex flex-col gap-3">
              <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">
                Import finished: {result.message.split(": ")[1]}
              </p>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Added", result.created],
                  ["Updated", result.updated],
                  ["Skipped", result.skipped],
                  ["Failed", result.failed],
                ].map(([k, v]) => (
                  <div key={k} className="panel p-3">
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="text-xl font-bold tabular-nums">{Number(v).toLocaleString("en-US")}</dd>
                  </div>
                ))}
              </dl>
              {result.report ? (
                <button type="button" className="btn self-start" onClick={() => download(`${file?.name.replace(/\.[^.]+$/, "") ?? entity}-errors.csv`, result.report!)}>
                  Download error report
                </button>
              ) : (
                <p className="text-[13px] text-muted">Every row was imported.</p>
              )}
            </section>
          )}

          <footer className="flex flex-wrap justify-end gap-2">
            {step === 3 ? (
              <>
                <button type="button" className="btn" onClick={reset}>
                  Import another file
                </button>
                <button type="button" className="btn btn-primary" onClick={() => dialog.current?.close()}>
                  Done
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn" onClick={() => dialog.current?.close()}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" disabled={!ok || pending || toWrite === 0} onClick={onCommit}>
                  {pending && step === 2 ? "Importing…" : `Import ${toWrite.toLocaleString("en-US")} rows`}
                </button>
              </>
            )}
          </footer>
        </div>
      </dialog>
    </>
  );
}
