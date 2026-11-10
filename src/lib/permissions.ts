import type { CurrentUser } from "./auth";

/**
 * Who may do what (Access Matrix v2.0). Pages hide buttons with these;
 * Server Actions check them again. Which *records* a user sees is decided
 * separately by the data scope in scope.ts.
 */
const MANAGES = ["admin", "sales_manager"];
/** Read & execute on CRM (leads, accounts, deals, quotations, orders, visits, tasks). */
const SELLS = ["admin", "executive", "sales_manager", "sales", "staff", "project_manager"];

export const canSell = (u: CurrentUser) => SELLS.includes(u.role);
export const canAddLeads = (u: CurrentUser) => SELLS.includes(u.role) || u.role === "marketing";
export const isManager = (u: CurrentUser) => MANAGES.includes(u.role);
/** Administration (users, departments, approval flows, settings): Super Admin only. */
export const isAdmin = (u: CurrentUser) => u.role === "admin";
export const canManageUsers = isAdmin;
// Who may approve what is decided per request by the approval engine (src/lib/approvals.ts).
/** Owner of a record, or a manager. */
export const canEditOwned = (u: CurrentUser, ownerId: string | null | undefined) => isManager(u) || ownerId === u.id;

/** Products & price list, sales targets, document templates. */
export const canManageCatalog = (u: CurrentUser) => isManager(u);
export const canManageTargets = (u: CurrentUser) => isManager(u);
/** Document templates stay with managers too (as in Batch 1); other settings are Super Admin only. */
export const canEditSettings = (u: CurrentUser) => isManager(u);
/** Campaigns and events. */
export const canManageMarketing = (u: CurrentUser) => isManager(u) || u.role === "marketing";
/** Record deposits / settlements on orders. */
export const canRecordPayments = (u: CurrentUser) => isManager(u) || u.role === "finance";
/** Discount % this user may give without approval (managers: no limit). */
export const discountLimitFor = (u: CurrentUser, salesLimit: number) => (isManager(u) ? 100 : salesLimit);
/** CSV import (Database → Import / Export). Employees: admins only, so nobody can create an admin account by import. */
export const canImport = (u: CurrentUser) => isManager(u);
export const canImportEntity = (u: CurrentUser, entity: string) => (entity === "employees" ? u.role === "admin" : isManager(u));
