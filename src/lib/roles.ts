/** Role list shared by server and client code (no database imports). */
export const ROLES = [
  "admin",
  "executive",
  "sales_manager",
  "sales",
  "marketing",
  "designer",
  "finance",
  "project_manager",
  "staff",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Names from the Access Matrix v2.0. `sales_manager` keeps its database code
 * but means "Department Head / Manager" of any department.
 */
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Super Admin",
  executive: "Executive / Director",
  sales_manager: "Department Head / Manager",
  sales: "Sales User",
  marketing: "Marketing User",
  designer: "Designer",
  finance: "Finance / Approver",
  project_manager: "Project Manager",
  staff: "General Staff",
};

/** Order used in pickers (most access first). */
export const ROLE_ORDER: Role[] = ["admin", "executive", "sales_manager", "finance", "project_manager", "sales", "marketing", "designer", "staff"];

/** Data scope per role: everything, own department (+ reports), or own records. */
export type ScopeLevel = "all" | "team" | "own";
export const ROLE_SCOPE: Record<Role, ScopeLevel> = {
  admin: "all",
  executive: "all",
  finance: "all",
  marketing: "all",
  designer: "all",
  sales_manager: "team",
  sales: "own",
  staff: "own",
  project_manager: "own",
};
