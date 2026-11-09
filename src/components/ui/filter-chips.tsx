import Link from "next/link";

/** Row of link chips that set one search param (server-side filtering). */
export function FilterChips({
  pathname,
  param,
  value,
  options,
  keep = {},
}: {
  pathname: string;
  param: string;
  value: string | undefined;
  options: { value: string | undefined; label: string; count?: number }[];
  keep?: Record<string, string | undefined>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const query = Object.fromEntries(
          Object.entries({ ...keep, [param]: o.value }).filter(([, v]) => v),
        ) as Record<string, string>;
        const on = o.value === value;
        return (
          <Link
            key={o.label}
            href={{ pathname, query }}
            className={`rounded-full border px-3 py-1 text-[13px] font-semibold ${
              on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-fg"
            }`}
          >
            {o.label}
            {o.count != null && <span className="ml-1.5 tabular-nums opacity-70">{o.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}

export function SearchBox({
  action,
  value,
  placeholder,
  keep = {},
}: {
  action: string;
  value: string;
  placeholder: string;
  keep?: Record<string, string | undefined>;
}) {
  return (
    <form action={action} className="w-full sm:w-auto">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <input name="q" defaultValue={value} placeholder={placeholder} aria-label={placeholder} className="input sm:w-64" />
    </form>
  );
}
