/**
 * Import column definitions (shared by the server and the wizard).
 * `aliases` are compared after lower-casing and stripping non-letters, so
 * "No. HP", "no_hp" and "NOHP" all match "nohp".
 */
export const IMPORT_ENTITIES = ["accounts", "contacts", "leads", "products", "employees", "targets"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export type ImportField = { key: string; label: string; required?: boolean; hint?: string; aliases?: string[] };

export const IMPORT_LABEL: Record<ImportEntity, string> = {
  accounts: "Accounts",
  contacts: "Contacts",
  leads: "Leads",
  products: "Products",
  employees: "Employees",
  targets: "Sales targets",
};

const phone = { key: "phone", label: "Phone", hint: "08…, 62… or +62…", aliases: ["nohp", "hp", "whatsapp", "wa", "telepon", "telp", "mobile", "phonenumber", "nomorhp"] };
const email = { key: "email", label: "Email", aliases: ["emailaddress", "surel"] };
const owner = { key: "ownerEmail", label: "Owner email", hint: "Empty = default owner", aliases: ["owner", "sales", "salesemail", "pic", "picemail"] };

export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  accounts: [
    { key: "name", label: "Name", required: true, aliases: ["accountname", "account", "company", "companyname", "nama", "namaakun", "perusahaan"] },
    { key: "segment", label: "Segment", required: true, hint: "Hotel & Spa, Retail Partner, Corporate Gift, Online & Event", aliases: ["businesstype", "segmen", "type"] },
    { key: "status", label: "Status", hint: "prospect, active, inactive", aliases: [] },
    { key: "city", label: "City", aliases: ["kota"] },
    { key: "address", label: "Address", aliases: ["alamat"] },
    phone,
    email,
    { key: "instagram", label: "Instagram", aliases: ["ig"] },
    owner,
    { key: "contactName", label: "Contact name", aliases: ["contact", "contactperson", "picname", "namakontak"] },
    { key: "contactPosition", label: "Contact position", aliases: ["position", "jabatan"] },
    { key: "consent", label: "Marketing consent", hint: "yes / no", aliases: ["marketingconsent", "consent", "persetujuan"] },
  ],
  contacts: [
    { key: "account", label: "Account", required: true, hint: "Exact account name", aliases: ["accountname", "company", "perusahaan", "akun"] },
    { key: "name", label: "Name", required: true, aliases: ["contactname", "nama"] },
    { key: "position", label: "Position", aliases: ["jabatan", "title"] },
    phone,
    email,
    { key: "decisionMaker", label: "Decision maker", hint: "yes / no", aliases: ["dm", "isdecisionmaker"] },
    { key: "notes", label: "Notes", aliases: ["note", "catatan"] },
  ],
  leads: [
    { key: "company", label: "Company", required: true, aliases: ["name", "companyname", "nama", "perusahaan"] },
    { key: "picName", label: "PIC", aliases: ["pic", "contact", "contactname", "contactperson"] },
    phone,
    email,
    { key: "segment", label: "Segment", required: true, aliases: ["segmen", "businesstype"] },
    { key: "city", label: "City", aliases: ["kota"] },
    { key: "campaign", label: "Campaign", hint: "Exact campaign name", aliases: ["kampanye"] },
    owner,
    { key: "receivedOn", label: "Received on", hint: "YYYY-MM-DD", aliases: ["received", "date", "tanggal"] },
    { key: "note", label: "Note", aliases: ["notes", "catatan", "need"] },
  ],
  products: [
    { key: "sku", label: "SKU", required: true, aliases: ["kode", "code", "productcode"] },
    { key: "name", label: "Name", required: true, aliases: ["product", "productname", "nama"] },
    { key: "category", label: "Category", aliases: ["kategori"] },
    { key: "variant", label: "Variant / size", aliases: ["variant", "size", "ukuran"] },
    { key: "unit", label: "Unit", hint: "pcs, bottle, jar, box, pack, jerrycan, set", aliases: ["satuan", "uom"] },
    { key: "price", label: "Retail price", required: true, hint: "Rupiah, excl. PPN", aliases: ["price", "retail", "harga", "hargaretail"] },
    { key: "stock", label: "Stock", aliases: ["stok", "qty"] },
    { key: "active", label: "Active", hint: "yes / no", aliases: ["aktif", "status"] },
  ],
  employees: [
    { key: "name", label: "Name", required: true, aliases: ["fullname", "nama"] },
    { key: "email", label: "Email", required: true, aliases: ["workemail", "surel"] },
    { key: "role", label: "Role", required: true, hint: "Admin, Executive, Sales Manager, Sales, Marketing, Designer, Finance", aliases: ["peran", "akses"] },
    { key: "position", label: "Position", aliases: ["jabatan", "title"] },
    { key: "department", label: "Department", aliases: ["divisi", "dept"] },
    { key: "region", label: "Region", aliases: ["area", "wilayah"] },
    phone,
    { key: "managerEmail", label: "Manager email", aliases: ["manager", "atasan", "reportsto"] },
    { key: "joinedOn", label: "Joined on", hint: "YYYY-MM-DD", aliases: ["joined", "joindate", "tanggalmasuk"] },
  ],
  targets: [
    { key: "repEmail", label: "Rep email", required: true, aliases: ["email", "sales", "salesemail", "rep"] },
    { key: "metric", label: "Metric", required: true, hint: "revenue, orders, visits, new_customers", aliases: ["kpi", "metrik"] },
    { key: "period", label: "Period", required: true, hint: "YYYY-MM", aliases: ["month", "bulan", "periode"] },
    { key: "target", label: "Target", required: true, aliases: ["value", "nilai", "amount"] },
  ],
};

/** Two example rows per template (dummy data). */
export const IMPORT_EXAMPLES: Record<ImportEntity, Record<string, string>[]> = {
  accounts: [
    { name: "Kayumanis Spa Sanur", segment: "Hotel & Spa", status: "prospect", city: "Denpasar, Bali", address: "Jl. Contoh No. 10, Sanur", phone: "0812 3000 1111", email: "spa@kayumanis.example", instagram: "kayumanis.spa", ownerEmail: "", contactName: "Ni Made Ayu", contactPosition: "Spa Manager", consent: "yes" },
    { name: "Toko Wangi Bandung", segment: "Retail Partner", status: "active", city: "Bandung, Jawa Barat", address: "", phone: "+62 813 2000 2222", email: "", instagram: "", ownerEmail: "", contactName: "Rudi Hartono", contactPosition: "Owner", consent: "no" },
  ],
  contacts: [
    { account: "Alas Harum Resort Ubud", name: "Putu Eka", position: "Front Office Manager", phone: "0812 4000 3333", email: "fo@alasharum.example", decisionMaker: "no", notes: "Best reached after 14:00" },
    { account: "PT Arunika Teknologi", name: "Sinta Dewi", position: "HR Lead", phone: "", email: "hr@arunika.example", decisionMaker: "yes", notes: "" },
  ],
  leads: [
    { company: "Rumah Teh Ubud", picName: "Kadek Sari", phone: "0813 5000 4444", email: "", segment: "Retail Partner", city: "Gianyar, Bali", campaign: "", ownerEmail: "", receivedOn: "2026-11-01", note: "Asked for a reseller price list" },
    { company: "PT Samudra Event", picName: "Andi", phone: "", email: "andi@samudra.example", segment: "Corporate Gift", city: "Jakarta", campaign: "", ownerEmail: "", receivedOn: "", note: "Year-end hampers, ~200 pcs" },
  ],
  products: [
    { sku: "RS-LEM-100", name: "Room Spray Lemongrass", category: "Home scent", variant: "100 ml", unit: "bottle", price: "95000", stock: "120", active: "yes" },
    { sku: "GB-MINI-002", name: "Mini Gift Box", category: "Gift set", variant: "3 items", unit: "box", price: "185.000", stock: "40", active: "yes" },
  ],
  employees: [
    { name: "Gede Pradnya", email: "gede@example.test", role: "Sales", position: "Sales Executive", department: "Sales", region: "Bali", phone: "0812 6000 5555", managerEmail: "manager@example.test", joinedOn: "2026-11-03" },
    { name: "Laras Ayu", email: "laras@example.test", role: "Marketing", position: "Content Specialist", department: "Marketing", region: "Bali", phone: "", managerEmail: "", joinedOn: "" },
  ],
  targets: [
    { repEmail: "sales@example.test", metric: "revenue", period: "2026-12", target: "260000000" },
    { repEmail: "sales@example.test", metric: "visits", period: "2026-12", target: "14" },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Suggested mapping: field key → column index (or -1). */
export function autoMap(entity: ImportEntity, headers: string[]): Record<string, number> {
  const hs = headers.map(norm);
  const used = new Set<number>();
  const out: Record<string, number> = {};
  for (const f of IMPORT_FIELDS[entity]) {
    const names = [f.key, f.label, ...(f.aliases ?? [])].map(norm);
    const idx = hs.findIndex((h, i) => !used.has(i) && names.includes(h));
    out[f.key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return out;
}
