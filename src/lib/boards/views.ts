/** The six ways to look at a board (all read the same items). */
export const BOARD_VIEWS = ["table", "kanban", "timeline", "calendar", "workload", "dashboard"] as const;
export type BoardViewKey = (typeof BOARD_VIEWS)[number];

export const BOARD_VIEW_LABEL: Record<BoardViewKey, string> = {
  table: "Main Table",
  kanban: "Kanban",
  timeline: "Timeline",
  calendar: "Calendar",
  workload: "Workload",
  dashboard: "Dashboard",
};

/** Too wide for a phone: a default (not a link) to these opens Main Table on small screens. */
export const WIDE_VIEWS: BoardViewKey[] = ["timeline", "workload"];

export const isBoardView = (v: unknown): v is BoardViewKey => typeof v === "string" && (BOARD_VIEWS as readonly string[]).includes(v);

/**
 * Which tab opens: an explicit ?view= link wins, then the user's own default
 * for this board, then the board's default (set by its owner), then Main Table.
 */
export function resolveView(param: unknown, mine: string | null | undefined, board: string | null | undefined): { view: BoardViewKey; source: "link" | "mine" | "board" | "none" } {
  if (isBoardView(param)) return { view: param, source: "link" };
  if (isBoardView(mine)) return { view: mine, source: "mine" };
  if (isBoardView(board)) return { view: board, source: "board" };
  return { view: "table", source: "none" };
}
