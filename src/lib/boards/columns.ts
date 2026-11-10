/**
 * Board column types and defaults (shared by server and browser).
 * Status/priority/dropdown labels carry a colour and — for statuses — a
 * CATEGORY. Reports, progress and automations use the category, never the label.
 */
export const STATUS_CATEGORIES = ["not_started", "working", "stuck", "done"] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<StatusCategory, string> = { not_started: "Not started", working: "Working on it", stuck: "Stuck", done: "Done" };

/** Label colours: solid fills with white text, readable in light and dark mode. */
export const LABEL_COLORS = {
  grey: "#6b7280",
  green: "#1f8a5b",
  orange: "#c26a10",
  red: "#c23b3b",
  blue: "#2b54c9",
  purple: "#7a4bc2",
  teal: "#13807a",
  pink: "#b8406f",
  brown: "#8a5a2b",
  navy: "#2f3e73",
} as const;
export type LabelColor = keyof typeof LABEL_COLORS;
export const colorHex = (c: string | undefined) => LABEL_COLORS[(c ?? "grey") as LabelColor] ?? LABEL_COLORS.grey;

/** Group bar colours (chart tokens). */
export const GROUP_COLORS = ["c1", "c2", "c3", "c4", "green", "orange", "red", "purple"] as const;
export const groupHex = (c: string) => (c.startsWith("c") ? `var(--${c})` : colorHex(c));

export type Label = { key: string; label: string; color: string; category?: StatusCategory };

export const DEFAULT_STATUS_LABELS: Label[] = [
  { key: "todo", label: "Not started", color: "grey", category: "not_started" },
  { key: "working", label: "Working on it", color: "orange", category: "working" },
  { key: "stuck", label: "Stuck", color: "red", category: "stuck" },
  { key: "done", label: "Done", color: "green", category: "done" },
];
export const DEFAULT_PRIORITY_LABELS: Label[] = [
  { key: "critical", label: "Critical", color: "navy" },
  { key: "high", label: "High", color: "purple" },
  { key: "medium", label: "Medium", color: "blue" },
  { key: "low", label: "Low", color: "teal" },
];

export const SYSTEM_COLUMNS = ["name", "status", "people", "timeline", "priority", "estimate_hours", "dependency", "link_account", "link_deal"] as const;
export type SystemColumn = (typeof SYSTEM_COLUMNS)[number];

export const CUSTOM_TYPES = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  status: "Status",
  dropdown: "Dropdown",
  date: "Date",
  checkbox: "Checkbox",
  people: "People",
  link: "Link",
  file: "Files",
} as const;
export type CustomType = keyof typeof CUSTOM_TYPES;
export type ColumnType = SystemColumn | CustomType;

/** Columns every new board starts with (position order). */
export const DEFAULT_COLUMNS: { key: SystemColumn; title: string; type: SystemColumn; width: number; settings?: Record<string, unknown>; hidden?: boolean }[] = [
  { key: "name", title: "Item", type: "name", width: 320 },
  { key: "people", title: "People", type: "people", width: 120 },
  { key: "status", title: "Status", type: "status", width: 150, settings: { labels: DEFAULT_STATUS_LABELS } },
  { key: "timeline", title: "Timeline", type: "timeline", width: 190 },
  { key: "priority", title: "Priority", type: "priority", width: 120, settings: { labels: DEFAULT_PRIORITY_LABELS } },
  { key: "estimate_hours", title: "Estimate (h)", type: "estimate_hours", width: 110 },
  { key: "dependency", title: "Depends on", type: "dependency", width: 150 },
  { key: "link_account", title: "Account", type: "link_account", width: 170 },
  { key: "link_deal", title: "Deal", type: "link_deal", width: 170, hidden: true },
];

export type FileValue = { key: string; name: string; size: number };
export type LinkValue = { url: string; text?: string };

export const labelsOf = (settings: Record<string, unknown> | null | undefined): Label[] => (Array.isArray(settings?.labels) ? (settings!.labels as Label[]) : []);
export const isDoneCategory = (labels: Label[], key: string | null | undefined) => labels.find((l) => l.key === key)?.category === "done";
