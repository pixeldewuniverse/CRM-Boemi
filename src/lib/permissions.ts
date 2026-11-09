import type { CurrentUser } from "./auth";

/** Who may create and edit sales records. */
const MANAGES = ["admin", "sales_manager"];
const SELLS = ["admin", "sales_manager", "sales"];

export const canSell = (u: CurrentUser) => SELLS.includes(u.role);
export const canAddLeads = (u: CurrentUser) => SELLS.includes(u.role) || u.role === "marketing";
export const isManager = (u: CurrentUser) => MANAGES.includes(u.role);
export const canApproveFees = (u: CurrentUser) => ["admin", "sales_manager", "finance"].includes(u.role);
/** Owner of a record, or a manager. */
export const canEditOwned = (u: CurrentUser, ownerId: string | null | undefined) => isManager(u) || ownerId === u.id;
