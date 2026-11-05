/** Role list shared by server and client code (no database imports). */
export const ROLES = [
  "admin",
  "executive",
  "sales_manager",
  "sales",
  "marketing",
  "designer",
  "finance",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  executive: "Executive",
  sales_manager: "Sales Manager",
  sales: "Sales",
  marketing: "Marketing",
  designer: "Designer",
  finance: "Finance",
};
