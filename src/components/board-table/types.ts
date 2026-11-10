import type { GroupSummary, ItemRow } from "@/lib/boards/queries";
import type { Label } from "@/lib/boards/columns";

export type { ItemRow, GroupSummary, Label };

export type Column = {
  id: string;
  key: string;
  title: string;
  type: string;
  settings: Record<string, unknown>;
  width: number;
  hidden: boolean;
  isSystem: boolean;
  position: number;
};

export type Person = { id: string; name: string; avatarKey: string | null };
export type Opt = { value: string; label: string };

export type GroupData = {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
  total: number;
  summary: GroupSummary | null;
  items: ItemRow[];
  /** Virtual group (group-by a column): no adding, no dragging. */
  virtual?: boolean;
};

export type BoardAccessProps = { manage: boolean; edit: boolean; editAssignedOnly: boolean };
