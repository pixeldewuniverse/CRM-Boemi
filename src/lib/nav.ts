/**
 * Navigation — mirrors the Phase 1 demo (demo.pixeldew.xyz):
 * 10 menus, each with submenus. Every submenu has its own page at
 * src/app/(app)/<menu>/<page>/page.tsx.
 */
import type { Role } from "./roles";

export type IconName =
  | "dash"
  | "pipe"
  | "mkt"
  | "order"
  | "act"
  | "acc"
  | "box"
  | "out"
  | "rep"
  | "proj"
  | "set";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  description: string;
  /** Only these roles may open the page (admin always can). Omit = everyone. */
  roles?: Role[];
};

export type NavCategory = {
  key: string;
  label: string;
  icon: IconName;
  /** Scope note shown next to the menu, e.g. "Later" or "Add-on". */
  badge?: "Later" | "Add-on";
  items: NavItem[];
};

/** Administration: Super Admin only (admin is always allowed, so the list is empty). */
const ADMIN_ONLY: Role[] = [];
/** Reporting: Executive and Department Head / Manager (+ admin). */
const REPORTING: Role[] = ["executive", "sales_manager"];

export const NAV: NavCategory[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "dash",
    items: [
      { key: "dashboard", href: "/dashboard", label: "Overview", description: "Target vs actual, today's work and what needs attention." },
      { key: "approvals", href: "/approvals", label: "Approvals", description: "Requests waiting for your decision — visit fees, quotation discounts — and the ones you sent." },
      { key: "calendar", href: "/calendar", label: "Calendar", description: "Tasks, planned visits, events, campaigns, quotation deadlines and content in one place." },
      { key: "dash-team", href: "/dashboard/team", label: "Team & Sales KPI", description: "Each rep's performance: monthly target, orders, pipeline and activity discipline." },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    icon: "pipe",
    items: [
      { key: "leads", href: "/sales/leads", label: "Leads", description: "New prospects from the website, Instagram, WhatsApp, events and referrals. Qualify a lead to turn it into an Account + Deal." },
      { key: "pipeline", href: "/sales/pipeline", label: "Pipeline", description: "Deals by stage, from first contact to won or lost." },
      { key: "forecast", href: "/sales/forecast", label: "Sales Forecast", description: "Expected revenue per month: weighted pipeline (value × probability), commit and best case against target and actual orders." },
      { key: "quotations", href: "/sales/quotations", label: "Quotations", description: "Wholesale quotations with price tiers applied automatically by account segment." },
      { key: "orders", href: "/sales/orders", label: "Orders", description: "B2B orders with deposits, final payments and delivery status." },
      { key: "visits", href: "/sales/visits", label: "Visits", description: "Sales check-ins with GPS and photo. Visit fees go to Finance for approval." },
      { key: "tasks", href: "/sales/tasks", label: "Tasks & Follow-up", description: "A board of follow-ups and department tasks, from to-do to done, plus a log of completed activities." },
      { key: "targets", href: "/sales/targets", label: "Targets", description: "Monthly targets per rep and channel." },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    icon: "mkt",
    items: [
      { key: "mkt-campaigns", href: "/marketing/campaigns", label: "Campaigns", description: "Product launches, B2B outreach and brand campaigns with their results." },
      { key: "mkt-attribution", href: "/marketing/attribution", label: "Lead Sources & Attribution", description: "Where leads come from and how many get qualified. Source is required when a lead is created." },
      { key: "mkt-content", href: "/marketing/content", label: "Content Calendar", description: "Content writers plan each post with a brief and guideline; designers upload the result for review; approved content is scheduled to publish." },
    ],
  },
  {
    key: "projects",
    label: "Projects",
    icon: "proj",
    items: [
      { key: "boards", href: "/projects", label: "Boards & Projects", description: "Project boards and team boards per department: items, owners, timelines and status in one table." },
    ],
  },
  {
    key: "ecommerce",
    label: "E-Commerce",
    icon: "order",
    badge: "Later",
    items: [
      { key: "ecom-orders", href: "/ecommerce/orders", label: "Online Orders", description: "Website and marketplace orders flow into the tools, so retail buyer history is recorded too." },
      { key: "ecom-channels", href: "/ecommerce/channels", label: "Website & Marketplace", description: "Connection status and 30-day performance for each online sales channel." },
      { key: "ecom-promo", href: "/ecommerce/promo", label: "Voucher & Promo", description: "Promo codes running on the website and marketplaces." },
    ],
  },
  {
    key: "event",
    label: "Event",
    icon: "act",
    items: [
      { key: "events", href: "/event/list", label: "Event List", description: "B2B exhibitions, pop-up stores and brand activations." },
      { key: "event-leads", href: "/event/leads", label: "Lead Capture", description: "Contacts collected at the booth. Convert relevant ones into leads so they enter the sales flow." },
      { key: "event-roi", href: "/event/roi", label: "Event Budget & ROI", description: "Cost of each event compared with the leads and revenue it produced." },
    ],
  },
  {
    key: "database",
    label: "Database",
    icon: "acc",
    items: [
      { key: "db-accounts", href: "/database/accounts", label: "Accounts", description: "Master data for B2B customers: hotels, spas, retailers and corporates, with qualification score." },
      { key: "db-contacts", href: "/database/contacts", label: "Contacts", description: "Every contact at every account: purchasing, spa managers, owners, buyers." },
      { key: "db-products", href: "/database/products", label: "Products & Price List", description: "SKU catalogue and price per tier. Tiers apply automatically to quotations and orders by account segment." },
      { key: "db-employees", href: "/database/employees", label: "Employees", description: "Employee master data for sales assignment, approvals and access rights." },
      { key: "db-import", href: "/database/import", label: "Import / Export", description: "Bulk-upload data from Excel/CSV and download data to work on elsewhere." },
    ],
  },
  {
    key: "consignment",
    label: "Consignment",
    icon: "box",
    badge: "Add-on",
    items: [
      { key: "cons-outlets", href: "/consignment/outlets", label: "Partner Outlets", description: "Outlets that sell our products on consignment." },
      { key: "cons-stock", href: "/consignment/stock", label: "Consigned Stock", description: "Stock at each partner outlet and sell-through per SKU." },
      { key: "cons-settlement", href: "/consignment/settlement", label: "Settlement", description: "Consignment sales per period, outlet commission and payment status." },
      { key: "cons-restock", href: "/consignment/restock", label: "Restock Schedule", description: "Restock visits to partner outlets, soonest first." },
    ],
  },
  {
    key: "store",
    label: "Store",
    icon: "out",
    badge: "Later",
    items: [
      { key: "store-overview", href: "/store/overview", label: "Store Overview", description: "Main Store performance at a glance." },
      { key: "store-sales", href: "/store/sales", label: "Daily Sales", description: "POS transactions per day. Weekends are marked." },
      { key: "store-stock", href: "/store/stock", label: "Store Stock", description: "Display and back-room stock at the Main Store. Items below minimum need a transfer from the central warehouse." },
    ],
  },
  {
    key: "report",
    label: "Report",
    icon: "rep",
    items: [
      { key: "rep-sales", href: "/report/sales", label: "Sales", description: "Revenue by channel, rep and product.", roles: REPORTING },
      { key: "rep-funnel", href: "/report/funnel", label: "Pipeline & Funnel", description: "Conversion between stages and win rate.", roles: REPORTING },
      { key: "rep-ar", href: "/report/receivables", label: "Receivables & Deposits", description: "Outstanding payments and deposits per account.", roles: [...REPORTING, "finance"] },
      { key: "rep-marketing", href: "/report/marketing", label: "Marketing & Event", description: "Campaign and event results against cost.", roles: REPORTING },
      { key: "rep-projects", href: "/report/projects", label: "Project Performance", description: "Projects per department: progress, on-time delivery, overdue items and budget vs actual.", roles: REPORTING },
      { key: "rep-departments", href: "/report/departments", label: "Department KPI", description: "Each department at a glance: revenue and conversion, leads and cost per lead, on-time projects and overdue work.", roles: REPORTING },
      { key: "rep-visits", href: "/report/visits", label: "Visits & Fees", description: "Visit volume per rep and visit fees paid.", roles: REPORTING },
    ],
  },
  {
    key: "settings",
    label: "Setting",
    icon: "set",
    items: [
      { key: "set-users", href: "/settings/users", label: "Users & Roles", description: "Who can sign in and what each role is allowed to do.", roles: ADMIN_ONLY },
      { key: "set-departments", href: "/settings/departments", label: "Departments & Teams", description: "Departments, their heads and sub-teams. A Department Head sees the data of everyone in their department.", roles: ADMIN_ONLY },
      { key: "set-approvals", href: "/settings/approvals", label: "Approval Workflows", description: "Who approves what: steps per request type, by amount.", roles: ADMIN_ONLY },
      { key: "set-master", href: "/settings/master-data", label: "Master Data", description: "Options used across every form.", roles: ADMIN_ONLY },
      { key: "set-templates", href: "/settings/templates", label: "Document Templates", description: "Numbering, tax and terms that appear on quotations and orders.", roles: ["sales_manager"] },
      { key: "set-integrations", href: "/settings/integrations", label: "Integrations", description: "How Sales & Marketing Tools connects to the other systems the business already uses.", roles: ADMIN_ONLY },
      { key: "set-gcloud", href: "/settings/google-cloud", label: "Google Cloud", description: "Sales & Marketing Tools runs inside your company's own Google Cloud project. You own the project, the billing and the data.", roles: ADMIN_ONLY },
      { key: "set-audit", href: "/settings/audit", label: "Audit Trail", description: "Every data change is recorded: who, when and what.", roles: ADMIN_ONLY },
    ],
  },
];

/**
 * Phase 2+ modules (badge "Later" / "Add-on": E-Commerce, Store, Consignment)
 * are hidden for now: not in the menu or search, and their URLs redirect to
 * the dashboard (src/proxy.ts). The pages stay in the code — set this to
 * true to show them again.
 */
export const SHOW_LATER_PHASES = false;

/** Categories shown in the menu. */
export const MENU: NavCategory[] = SHOW_LATER_PHASES ? NAV : NAV.filter((c) => !c.badge);

/** URL prefixes of hidden categories (used by the proxy). */
export const HIDDEN_PREFIXES: string[] = SHOW_LATER_PHASES ? [] : NAV.filter((c) => c.badge).map((c) => `/${c.items[0].href.split("/")[1]}`);

export type NavMatch = { category: NavCategory; item: NavItem };

const BY_HREF = new Map<string, NavMatch>(
  NAV.flatMap((category) => category.items.map((item) => [item.href, { category, item }] as const)),
);

export function findNav(pathname: string): NavMatch | undefined {
  return BY_HREF.get(pathname.replace(/\/$/, "") || "/");
}

export function canOpen(item: NavItem, role: Role): boolean {
  return !item.roles || role === "admin" || item.roles.includes(role);
}

