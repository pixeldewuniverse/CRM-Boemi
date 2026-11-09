import type { ReactNode } from "react";

export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
  flush = false,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No inner padding (for tables). */
  flush?: boolean;
}) {
  return (
    <section className={`panel min-w-0 ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="font-bold">{title}</h2>}
            {description && <p className="text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "overflow-x-auto" : "p-4"}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-muted">{children}</p>;
}

/** Notice used on Later / Add-on modules that show sample data only. */
export function PreviewNotice({ kind }: { kind: "Later" | "Add-on" }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-4 py-3 text-[13px] text-muted">
      <span className={`pill ${kind === "Later" ? "bg-info-soft text-info" : "bg-warn-soft text-warn"}`}>
        {kind === "Later" ? "Next stage" : "Add-on"}
      </span>
      Preview with sample data.{" "}
      {kind === "Later"
        ? "This module is planned for a later stage and is not connected to live data yet."
        : "Optional module, quoted separately; not connected to live data yet."}
    </div>
  );
}
