import type { IconName } from "@/lib/nav";

/** Line icons from the Phase 1 demo. */
const PATHS: Record<IconName | "chevron" | "bell" | "menu" | "close" | "search", React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  dash: <path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z" />,
  pipe: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="10" rx="1" />
      <rect x="17" y="4" width="4" height="6" rx="1" />
    </>
  ),
  mkt: (
    <>
      <path d="M3 11v3l12 5V6L3 11z" />
      <path d="M15 9a3 3 0 0 1 0 6" />
    </>
  ),
  order: (
    <>
      <path d="M3 7h18l-2 12H5z" />
      <path d="M8 7V5a4 4 0 0 1 8 0v2" />
    </>
  ),
  act: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  acc: (
    <>
      <path d="M3 21V7l9-4 9 4v14" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  box: <path d="M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10" />,
  out: (
    <>
      <path d="M4 10h16l-1-5H5zM5 10v10h14V10" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  rep: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  set: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7.3 19.6l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4.4 7.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export function Icon({
  name,
  className = "size-[17px]",
}: {
  name: keyof typeof PATHS;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7] ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
