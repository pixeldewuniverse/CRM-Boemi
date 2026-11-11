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
        <h1 className="font-display text-[30px] font-normal leading-tight [text-wrap:balance] md:text-[34px]">
          {title}
        </h1>
        {description && <p className="mt-1 max-w-[62ch] text-muted">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
