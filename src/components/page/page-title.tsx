import type { ReactNode } from "react";

export function PageTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] [text-wrap:balance] md:text-[30px]">
          {title}
        </h1>
        {description && <p className="mt-1 max-w-[62ch] text-muted">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
