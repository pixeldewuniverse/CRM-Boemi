import type { CurrentUser } from "./auth";

/** Who may do what. Pages hide buttons with these; Server Actions check them again. */
const MANAGES = ["admin", "sales_manager"];
const SELLS = ["admin", "sales_manager", "sales"];

export const canSell = (u: CurrentUser) => SELLS.includes(u.role);
export const canAddLeads = (u: CurrentUser) => SELLS.includes(u.role) || u.role === "marketing";
export const isManager = (u: CurrentUser) => MANAGES.includes(u.role);
export const canApproveFees = (u: CurrentUser) => ["admin", "sales_manager", "finance"].includes(u.role);
/** Owner of a record, or a manager. */
export const canEditOwned = (u: CurrentUser, ownerId: string | null | undefined) => isManager(u) || ownerId === u.id;

/** Products & price list, sales targets, document templates. */
export const canManageCatalog = (u: CurrentUser) => isManager(u);
export const canManageTargets = (u: CurrentUser) => isManager(u);
export const canEditSettings = (u: CurrentUser) => isManager(u);
/** Campaigns and events. */
export const canManageMarketing = (u: CurrentUser) => isManager(u) || u.role === "marketing";
/** Record deposits / settlements on orders. */
export const canRecordPayments = (u: CurrentUser) => isManager(u) || u.role === "finance";
/** Approve a quotation discount above the sales limit. */
export const canApproveDiscounts = (u: CurrentUser) => isManager(u);
/** Discount % this user may give without approval (managers: no limit). */
export const discountLimitFor = (u: CurrentUser, salesLimit: number) => (isManager(u) ? 100 : salesLimit);
/** CSV import (Database → Import / Export). Employees: admins only, so nobody can create an admin account by import. */
export const canImport = (u: CurrentUser) => isManager(u);
export const canImportEntity = (u: CurrentUser, entity: string) => (entity === "employees" ? u.role === "admin" : isManager(u));
