# BOEMI — Sales & Marketing Tools

Portal internal Sales & Marketing untuk BOEMI. Saat ini berjalan sebagai **staging** di Vercel + Neon, dan dirancang supaya bisa dipindah ke **Google Cloud milik BOEMI** (Cloud Run + Cloud SQL + Cloud Storage) tanpa menulis ulang kode.

> ⚠️ **Staging hanya untuk data dummy.** Data customer asli BOEMI baru dimasukkan setelah aplikasi pindah ke Google Cloud BOEMI (UU PDP & kesepakatan dengan client).

## Stack

| Bagian | Staging | Production (Google Cloud BOEMI) |
| --- | --- | --- |
| App | Next.js 16 (App Router, Cache Components) di Vercel | Docker image di **Cloud Run** |
| Database | Neon Postgres (Singapore) | **Cloud SQL for PostgreSQL** |
| File (foto visit, nota) | Vercel Blob (private) | **Cloud Storage** (`STORAGE_DRIVER=gcs`) |
| Cron | Vercel Cron (`vercel.json`) | **Cloud Scheduler** → endpoint yang sama |
| Email | log saja / SMTP | SMTP Google Workspace |

ORM: **Drizzle** + driver `postgres` standar (tanpa fitur khusus Neon). Auth: sesi cookie terenkripsi (`iron-session`) + bcrypt; login Google Workspace (SSO) menyusul setelah Workspace BOEMI siap.

## Mulai lokal

```bash
npm install
cp .env.example .env          # isi DATABASE_URL, SESSION_SECRET, CRON_SECRET, SEED_ADMIN_PASSWORD
npm run db:migrate            # jalankan migrasi ke database
npm run db:seed               # data dummy: admin/manager/sales @example.test
npm run dev
```

### Di Vercel (tanpa terminal)

Script `vercel-build` otomatis menjalankan **migrasi** lalu **seed dummy** setiap deploy, sebelum `next build`:

1. Set env di Vercel: `SESSION_SECRET`, `CRON_SECRET`, `APP_URL`, dan `SEED_ADMIN_PASSWORD` (sekali saja).
2. Redeploy → tabel + akun demo terbentuk.
3. Setelah berhasil login, **hapus `SEED_ADMIN_PASSWORD`** dari Vercel. Seed tidak akan jalan lagi; migrasi tetap jalan otomatis di setiap deploy.

Login dengan `sales@example.test` (atau `admin@` / `manager@`) dan password dari `SEED_ADMIN_PASSWORD`.

### Script

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | Generate route types + `tsc` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Buat file migrasi dari perubahan `src/db/schema.ts` |
| `npm run db:migrate` | Terapkan migrasi (pakai `DATABASE_URL_UNPOOLED` bila ada) |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Isi data dummy |

## Struktur

```
src/
  app/
    (app)/            halaman yang butuh login (shell menu ala demo)
      [section]/[page]/  semua submenu yang belum dibangun → placeholder modul
    login/            halaman login
    actions/          Server Actions (auth, notifikasi)
    api/
      cron/[job]/     job terjadwal (dilindungi CRON_SECRET)
      files/[...key]/ akses file private (wajib login)
      health/         health check untuk Cloud Run
  db/
    schema.ts         skema Phase 1 (16 tabel)
    seed.ts           data dummy
  lib/
    nav.ts            menu & submenu (10 menu, 41 submenu, sama dengan demo.pixeldew.xyz)
    roles.ts          daftar role + label
    auth.ts           Data Access Layer: getCurrentUser / verifyUser / requireRole
    customers.ts      scope data per role (sales hanya lihat customer miliknya)
    notifications/    notifikasi in-app + email (+ preferensi per user)
    storage/          adapter file: vercel-blob | gcs
    cron.ts           daftar job terjadwal
    email.ts          SMTP (dry-run kalau SMTP_HOST kosong)
    phone.ts          normalisasi no. HP ke +62… untuk cek duplikat
    audit.ts          audit trail
  proxy.ts            redirect cepat ke /login bila belum ada cookie
drizzle/              file migrasi SQL (commit ke git)
```

## Menu

Struktur menu mengikuti demo Phase 1 (`demo.pixeldew.xyz`), didefinisikan di `src/lib/nav.ts`; setiap submenu punya halaman di `src/app/(app)/<menu>/<halaman>/page.tsx`.

- **Dashboard, Sales, Marketing, Event, Database, Report, Setting** membaca database. Sales hanya melihat data miliknya; Setting hanya untuk Admin & Sales Manager.
- **E-Commerce, Store (Later) dan Consignment (Add-on)** menampilkan data contoh statis (`src/lib/preview.ts`) dengan label *Preview* — belum ada tabel database.
- Detail akun 360°: `/database/accounts/[id]`. Export CSV: `/api/export/{leads|accounts|contacts|products|orders}`.

### Fitur CRUD (Batch 1)

| Fitur | Halaman | Siapa boleh mengubah |
| --- | --- | --- |
| Kontak (tambah/edit/hapus, HP dinormalisasi, cek duplikat HP/email) | `/database/contacts` + panel *Contacts* di detail akun | Pemilik akun atau manager |
| Edit akun (segmen → tier harga, status, alamat, campaign, owner) | Detail akun → **Edit account** | Pemilik akun atau manager (ganti owner: manager) |
| Produk & price list (SKU unik, varian, satuan, harga retail, aktif/nonaktif; harga tier otomatis dari `pricing.ts`) | `/database/products` | Admin & Sales Manager. Produk yang sudah dipakai di quotation/order tidak bisa dihapus, hanya dinonaktifkan |
| Target per rep × metrik (revenue, orders, visits, new customers) × bulan, grid editable + **Copy last month**, actual vs target | `/sales/targets?period=YYYY-MM` | Admin & Sales Manager (lainnya read-only) |
| Quotation: dari akun/deal, produk + qty, tier dari segmen akun, diskon %, PPN on/off, valid until; total dihitung ulang di server | `/sales/quotations`, `/sales/quotations/[id]` | Pemilik atau manager |
| Status quotation `draft → sent → accepted / rejected / expired` (expired otomatis lewat cron) | Detail quotation | Pemilik atau manager |
| Diskon di atas batas sales (default 10%) → **approval manager** sebelum bisa dikirim | Detail quotation | Approve/reject: Admin & Sales Manager |
| Print / PDF (A4, tanda DRAFT untuk draft) | `/print/quotations/[id]` → *Print / Save as PDF* | Siapa pun yang boleh melihat quotation |
| **Convert to order** dari quotation accepted (deal otomatis Won) | Detail quotation | Pemilik atau manager |
| Order manual / dari quotation; status `draft → confirmed → processing → completed / cancelled`; pengiriman `pending → shipped → delivered` | `/sales/orders`, `/sales/orders/[id]` | Pemilik atau manager |
| Pembayaran: deposit / pelunasan dengan nominal, tanggal, metode, referensi; status bayar (unpaid/deposit/paid) dihitung dari pembayaran | Detail order → **+ Payment** | Catat: pemilik order, Finance, manager. Hapus (koreksi): Finance & manager |
| Campaign (budget, periode, PIC, status, hasil) — akun/lead bisa ditautkan | `/marketing/campaigns` | Marketing, Sales Manager, Admin |
| Event (budget, tanggal, lokasi, PIC, campaign, hasil) | `/event/list` | Marketing, Sales Manager, Admin |
| **Log activity** (Call, WhatsApp, Email, Meeting, Note) di akun & per deal; timeline gabungan visit, aktivitas, task, quotation, order | Detail akun | Sales & manager; hapus: penulis atau manager |
| Template dokumen: prefix, format nomor (`{PREFIX}-{YY}{MM}-{SEQ}`), digit counter, reset per bulan/tahun, masa berlaku, batas diskon, syarat & ketentuan, data perusahaan & bank di PDF | `/settings/templates` | Admin & Sales Manager |

### Import CSV (Batch 2)

**Database → Import / Export** (`/database/import`): import untuk Accounts (+ kontak utama), Contacts, Leads, Products, Employees, dan Sales targets. Setiap entitas punya tombol **Template** (header + 2 baris contoh dummy).

1. **Upload**: CSV maks 5 MB / 5.000 baris, pemisah `,` / `;` / tab terdeteksi otomatis, UTF-8 (BOM dibuang; file Windows-1252 dari Excel lama tetap terbaca dengan peringatan). File `.xlsx` ditolak dengan petunjuk *Save As → CSV UTF-8*.
2. **Check & map**: kolom dicocokkan otomatis dari header (termasuk alias Indonesia seperti *No HP*, *Perusahaan*, *Segmen*) dan bisa diubah. Setiap baris divalidasi di server: HP → +62…, email, segmen, tanggal (YYYY-MM-DD atau DD/MM/YYYY), angka Rupiah (`185.000`). Duplikat dicek **di dalam file** dan **di database** — akun/lead lewat aturan `findDuplicate` (HP/email), kontak lewat HP/email, produk lewat SKU, user lewat email, target lewat rep + metrik + periode. Duplikat bisa **Skip** atau **Update** (hanya sel yang terisi yang menimpa data; sel kosong tidak menghapus).
3. **Import**: disimpan dalam transaksi per 500 baris (batch yang gagal diulang per baris), ringkasan hasil, dan **Download error report** (CSV berisi baris yang gagal/dilewati + alasannya).

Aturan: akun & lead hasil import mendapat source **Import** (`source_detail` = nama file), owner dari kolom *Owner email* atau owner default yang dipilih (default: importer). Kontak dirujuk ke akun lewat nama akun persis. User hasil import dibuat **non-aktif tanpa password** sampai di-invite. Izin: Admin & Sales Manager; **Employees hanya Admin**. Setiap import = 1 entri audit (entitas, nama file, jumlah baris & hasil). File tidak disimpan: browser mengirim isinya untuk preview, lalu sekali lagi saat import, dan server memvalidasi ulang (batas body Server Action dinaikkan ke 8 MB di `next.config.ts`).

Kode: `src/lib/csv.ts` (parser RFC 4180), `src/lib/import/fields.ts` (kolom, alias, contoh), `src/lib/import/run.ts` (validasi & commit), `src/app/actions/import.ts`, `src/app/api/import/template/[entity]`, `src/components/forms/import-wizard.tsx`. Tidak ada tabel baru.

### Dashboard & Workspace (Batch 3)

- **Global search** — kotak *Search…* di header atau **Ctrl/Cmd+K**. Mencari akun, kontak, lead, deal, quotation, order, produk (SKU/nama), task, campaign, event, dan halaman menu; maks 5 hasil per tipe (+ link "All N"). Bisa pakai nomor HP. Hasil mengikuti scope role yang sama dengan halaman daftarnya (sales hanya datanya sendiri; tipe yang menunya tidak boleh dibuka role itu tidak ditampilkan). Query: `ILIKE` + index trigram `pg_trgm` (migrasi `0007`, dibuat hanya bila ekstensi tersedia — Neon & Cloud SQL mendukung; tanpa ekstensi tetap jalan). Kode: `src/lib/queries/search.ts`, `src/app/actions/search.ts`, `src/components/shell/command-palette.tsx`.
- **Calendar** (`/calendar`, menu Dashboard) — tampilan Month / Week / Agenda (Agenda otomatis di HP). Sumber: task (due), visit *planned*, event, campaign (hari mulai ▶ & selesai ■), quotation *sent* (valid until), jadwal konten. Filter **Me / My team** (Sales Manager: dirinya + bawahan) **/ Everyone** (Admin & Executive) dan per tipe; sales selalu *Me* (dipaksa di server). Klik item → detail; tombol **+** di tiap hari membuat task dengan tanggal terisi. Sinkron Google Calendar: interface saja di `src/lib/calendar/sync.ts` (belum aktif).
- **My profile** (`/profile`, dari menu avatar) — ubah nama & telepon, foto profil (dipotong persegi & dikecilkan di browser, disimpan di storage `avatars/…`, dilihat lewat `/api/files`), ganti password (cek password lama, bcrypt, min. 10 karakter; **perangkat lain otomatis logout** lewat `users.session_version`), detail kerja read-only, dan pengaturan notifikasi per jenis (in-app / email / HP-laptop) + link ke perangkat push.

Migrasi Batch 3: `0006_profile_avatar_session.sql` (`users.avatar_key`, `users.session_version`), `0007_search_trgm.sql` (pg_trgm + index trigram, bersyarat).

### User & RBAC + Approval Engine (Batch 4)

**Role (Access Matrix v2.0).** Kode enum tetap; label baru: `admin` = Super Admin, `executive` = Executive / Director, `sales_manager` = **Department Head / Manager** (departemen apa pun), `finance` = Finance / Approver, `sales` = Sales User, `marketing` = Marketing User, `designer`, dan role baru `project_manager` & `staff` (General Staff).

| Modul | Akses |
| --- | --- |
| Dashboard, CRM & Sales, Marketing, Event, Database, Approvals | semua role (read & execute) |
| Report | Executive, Manager, Admin (Finance: hanya Receivables) |
| Setting | Super Admin (Document Templates juga Manager) |

**Scope data** (`src/lib/scope.ts`, `ROLE_SCOPE` di `roles.ts`): *all* = admin, executive, finance, marketing, designer · *team* = Department Head / Manager: semua orang di departemennya (+ sub-departemen), bawahan langsung, dirinya, dan record tanpa owner · *own* = sales, staff, project manager. Semua halaman, search, export, kalender, dan file memakai scope ini; halaman Report & Setting dicek di server (`guard()`).

- **Users & Roles** (`/settings/users`): tambah, edit, aktif/nonaktif, reset password. Password sementara (12 karakter) dikirim lewat email dan ditampilkan sekali ke admin; user **wajib ganti password** saat login pertama (`/change-password`). Tidak bisa menonaktifkan/menurunkan **Super Admin aktif terakhir** atau diri sendiri. Nonaktif / reset / ganti role → sesi user langsung putus. User hasil import diaktifkan lewat *Activate & invite*. Persiapan Google Workspace: `users.auth_provider` (`password` | `google`) + `google_sub`.
- **Departments & Teams** (`/settings/departments`): nama, kode, kepala, induk. Kolom teks lama `users.department` diisi otomatis ke tabel `departments` oleh migrasi dan tetap disinkronkan.
- **Approval engine** (`src/lib/approvals.ts`): `approval_flows` (tipe: visit_fee, quotation_discount, project, project_budget, purchase_request; rentang nominal; prioritas) → `approval_flow_steps` (approver: role tertentu — boleh beberapa —, orang tertentu, atasan langsung, kepala departemen) → `approval_requests` + `approval_actions` (step disalin saat diajukan; status, catatan, waktu per step). Pemohon tidak bisa menyetujui permintaannya sendiri; bila step tidak menemukan approver → Super Admin. Notifikasi ke approver tiap step & ke pemohon saat selesai.
  - **Visit fee**: default 1 step *Manager atau Finance* (sama dengan perilaku lama); fee lama yang masih pending dimigrasikan jadi request. Contoh tambahan (seed): fee ≥ Rp 500.000 → atasan langsung, lalu Finance.
  - **Diskon quotation** di atas batas sales memakai engine yang sama (nominal = % diskon).
  - **Approvals** (`/approvals`, menu Dashboard, ada badge): kotak masuk approver + riwayat permintaan sendiri.
  - **Approval Workflows** (`/settings/approvals`): daftar & editor workflow (urutan step bisa di-drag, juga dengan keyboard) + **Test**: "siapa approver untuk nominal X dari orang Y?".
  - Cron `pending-visit-fees` sekarang mengingatkan semua approval yang tertunda > 24 jam (nama job tetap, jadwal Cloud Scheduler tidak berubah).

Migrasi Batch 4: `0008_rbac_departments_approvals.sql` (enum role + `project_manager`, `staff`; `departments`; kolom user baru; 4 tabel approval; backfill departemen, flow default, dan request untuk fee/diskon yang masih pending). Library kecil baru: `@dnd-kit/sortable` + `@dnd-kit/utilities` (keluarga @dnd-kit yang sudah dipakai) untuk mengurutkan step.

Kenapa tabel `activities` terpisah dari `tasks`: task = pekerjaan yang **akan** dilakukan (assignee, deadline, pengingat, board Kanban, KPI "overdue"); activity = catatan yang **sudah** terjadi. Memakai `tasks` untuk log akan mengotori board & pengingat dan butuh banyak kolom kosong. Aktivitas tetap ikut dihitung di KPI *activities* rep.

Nomor dokumen dibuat atomik di `document_counters` (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), jadi dua user yang menyimpan bersamaan tidak mendapat nomor yang sama. Semua create/update/delete/approve/payment tercatat di **Setting → Audit Trail**.

### Projects — Board & Table view (Batch 5a)

Menu baru **Projects → Boards & Projects** (`/projects`): board per *workspace* (= departemen), filter Projects / Team boards / Archived, cari nama atau kode PRJ. Satu board = **project** (kode `PRJ-YYYY-NNN` dari `document_counters`, status, prioritas, akun, deal, budget, biaya aktual, tanggal) atau **team board**. Pekerjaan project disimpan di tabel baru `board_items` (bukan `tasks`); keduanya digabung nanti di *My Work* (5e).

- **Tabel** (`/projects/[boardId]`, `src/components/board-table/`): grup berwarna (rename, collapse, warna, urutan, hapus + pindahkan item), header kolom per grup, ringkasan per grup (status battery, jumlah angka, rentang timeline, jumlah orang, total estimasi), edit per sel dengan update optimistis, subitem (1 level), drag baris antar posisi/grup (@dnd-kit, juga keyboard), pilih banyak → pindah grup / status / orang / duplikat / arsip / hapus (hapus hanya owner), panel item (semua field, subitem, activity), mobile = kartu per grup.
- **Kolom**: system (`name`, `status`, `people`, `timeline`, `priority`, `estimate_hours`, `dependency`, `link_account`, `link_deal` — tidak bisa dihapus, boleh rename/hide) + custom (text, long text, number dengan prefix/unit mis. Rp, status, dropdown multi, date, checkbox, people, link, files ≤ 3,5 MB di `boards/<boardId>/…`). Label status punya warna + **kategori** (not started / working / stuck / done); laporan, progress dan otomasi memakai kategori. Status wajib punya minimal satu label *done*.
- **Toolbar**: cari, filter orang/status/grup/tanggal, sort, group-by (status/prioritas/orang = grup virtual, maks 500 item, tanpa drag), kolom (owner: show/hide + urutan untuk semua; user lain: sembunyikan untuk diri sendiri lewat URL). Semua tersimpan di URL.
- **Skala**: 50 item per grup + *Show more*; ringkasan dihitung di database atas semua item yang cocok. Posisi pecahan (`double`) + renumber otomatis.
- **Konflik**: last-write-wins; bila orang lain mengubah item setelah halaman dimuat, perubahan tetap tersimpan dan muncul toast "X also changed …".
- **Dependency** FS/SS/FF/SF + lag hari; loop ditolak (CTE rekursif). Mode strict/flexible disimpan di board (dipakai Timeline di 5b).
- **Approval project**: *Submit for approval* memakai Approval Engine (tipe `project`, nominal = budget). Tidak ada workflow yang cocok → langsung Active. Seed: project ≥ Rp 50 jt → Executive.

**Akses** (`src/lib/boards/access.ts`, dipakai di setiap action & query):

| Siapa | Hak |
| --- | --- |
| Super Admin | semua |
| Executive | lihat semua board (termasuk private) |
| Department Head | kelola semua board departemennya (+ sub-departemen) |
| Owner board / PM pembuat | kelola board-nya (kolom, grup, member, detail, arsip) |
| Editor | edit item; opsi *edit own only* = hanya item yang di-assign ke dia |
| Viewer / staf lain | ikut visibility: department = anggota departemen lihat, shared = semua lihat, private = hanya member |

Yang boleh membuat board/project: Super Admin, Department Head, Project Manager, Executive. Edit sel hanya masuk **activity item** (`board_item_activity`); buat/hapus/arsip/bulk/kolom/grup/member/detail/submit masuk **Audit Trail**.

Migrasi Batch 5a: `drizzle/0009_boards.sql` (9 tabel board + enum). Tidak ada library baru (`@dnd-kit/sortable` sudah ada sejak Batch 4).

## Data demo

`src/db/seed.ts` mengisi data dummy dari demo (`src/db/demo/demo-data.json`): 8 user persona, 12 akun, 14 produk, lead, deal, quotation, order + riwayat 12 bulan, visit, task, target, campaign, event, konten. Tanggal digeser supaya "hari ini" di demo = hari seed dijalankan.

Data Batch 1 (`ensureBatch1Demo`, aman dijalankan berulang — juga mengisi database staging yang sudah di-seed sebelumnya): satuan produk, catatan kontak, 13 log aktivitas, target 4 metrik (bulan ini & lalu), riwayat pembayaran deposit/pelunasan, status pengiriman, data perusahaan dummy untuk PDF, counter nomor dokumen yang melanjutkan nomor demo, 1 quotation draft dengan diskon 15% yang menunggu approval manager, tautan campaign di beberapa akun.

Data Batch 5a (`ensureBatch5Demo`): project **Alas Harum — Amenities Rollout Q1** (PM Rizky; grup Planning/Production/Delivery; 15 item + 6 subitem, dependency, 1 milestone; kolom Budget (Rp), Channel, Approved, Brief, Notes; member Komang & Ayu editor, Sri designer *edit own only*) dan team board **Content Requests** di Marketing, plus workflow approval project ≥ Rp 50 jt.

Login demo (password = `SEED_ADMIN_PASSWORD` saat seed pertama): `admin@`, `manager@`, `sales@`, `dewi@`, `putu@`, `marketing@`, `finance@`, `designer@`, `owner@`, `staff@`, `pm@example.test`.

## Skema Phase 1

`users` (role: admin, executive, sales_manager, sales, marketing, finance) · `customers` (sumber/UTM, consent marketing, minat produk, **skor & tier kualifikasi + alasan**) · `contacts` (+ catatan) · `qualification_criteria` (kriteria dari client + bobot) · `visits` (GPS + foto) · `visit_fees` (approval finance) · `tasks` (follow-up + deadline) · `products` (+ satuan) · `opportunities` (pipeline) · `quotations` / `quotation_items` (+ approval diskon, syarat, waktu kirim/keputusan) · `orders` / `order_items` (+ link quotation, status pengiriman) · `order_payments` (deposit/pelunasan) · `activities` (log call/WA/email/meeting/note) · `campaigns` · `events` · `kpi_targets` · `app_settings` (template dokumen & data perusahaan) · `document_counters` (nomor dokumen) · `notifications` / `notification_preferences` · `audit_logs`.

Migrasi Batch 1: `drizzle/0005_batch1_crud.sql` — termasuk backfill: order lama berstatus *shipped/delivered* dipindah ke `delivery_status` (status order jadi *processing*), dan `paid_amount` lama menjadi baris `order_payments`.

Uang disimpan sebagai Rupiah bulat (`bigint`).

## Notifikasi

Saat ini: **in-app + email**. Setiap user bisa mengatur per jenis notifikasi (`notification_preferences`). Jenis yang sudah ada: tugas di-assign, tugas jatuh tempo ≤ 24 jam, tugas terlambat, visit fee menunggu/diputuskan, perubahan stage pipeline, lead Hot baru, diskon quotation perlu approval / sudah diputuskan, quotation diterima customer, pembayaran dicatat di order.

Google Chat & Google Calendar bisa ditambahkan sebagai channel setelah Google Workspace BOEMI dikonfirmasi — cukup ubah `src/lib/notifications/index.ts`.

## Push notifications (HP & laptop)

Web Push (VAPID): gratis, tanpa vendor. Setiap user menyalakannya sekali per perangkat di **Notifikasi → Turn on notifications**. iPhone: buka di Safari → Share → **Add to Home Screen**, buka dari ikon itu, lalu nyalakan (iOS 16.4+). Notifikasi yang sama juga tersimpan in-app dan (jika SMTP diset) dikirim via email.

Env yang dibutuhkan: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (URL aplikasi atau `mailto:`). Buat **sekali** dan jangan diganti (mengganti kunci mematikan notifikasi di semua perangkat). Cara membuat tanpa terminal — paste di Console browser (F12):

```js
const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log("VAPID_PUBLIC_KEY=" + b64u(await crypto.subtle.exportKey("raw", k.publicKey)) + "\nVAPID_PRIVATE_KEY=" + (await crypto.subtle.exportKey("jwk", k.privateKey)).d);
```

Saat pindah ke Google Cloud, pakai **kunci yang sama** (simpan di Secret Manager) supaya perangkat yang sudah terdaftar tetap menerima notifikasi.

## Siapa dapat notifikasi apa

| Role | Notifikasi |
| --- | --- |
| Sales | Task di-assign / jatuh tempo / terlambat, visit fee disetujui/ditolak, deal atau task miliknya dipindah orang lain, lead di-assign kepadanya, diskon quotation disetujui/ditolak, pembayaran dicatat Finance di order-nya |
| Sales Manager | Lead baru & lead di-qualify oleh tim, deal Won/Lost, visit fee menunggu approval, task tim di *Waiting approval*, **diskon quotation perlu approval**, quotation diterima customer, ringkasan harian |
| Finance | Visit fee menunggu approval (langsung + pengingat harian) |
| Marketing | Konten siap di-review, konten dipublikasikan, task |
| Designer | Konten siap didesain, revisi diminta (dengan catatan), konten disetujui |
| Executive | Ringkasan harian (pendapatan kemarin, bulan berjalan vs target, deal menang, lead, visit, fee & task tertunda) |

Notifikasi tidak dikirim ke orang yang melakukan aksi itu sendiri. Semua lewat in-app + push (+ email bila SMTP diset).

## Integrasi form journey (journey.boemibotanicals.com)

Situs aroma journey mengirim tamu ke `POST /api/leads/journey` (header `Authorization: Bearer JOURNEY_SYNC_KEY`).

- Hanya tamu yang **mencentang persetujuan penawaran** yang dikirim, sebagai lead sumber *Aroma journey*, segmen *Online & Event*, belum ada pemilik. Marketing/Sales Manager membagikannya lewat tombol **Assign**.
- Data: nama, WhatsApp, Instagram, email, ulang tahun, pilihan take-home, dan hasil aroma (setelah quiz selesai).
- Tamu yang sama dikirim ulang → lead yang sama diperbarui (tidak dobel). Nomor/email yang sudah jadi akun → dicatat di akun, bukan lead baru.
- Tamu yang mencabut persetujuan → hanya `{ externalId, marketingConsent: false }` yang dikirim; lead ditandai tanpa consent.
- Marketing mendapat maksimal 1 notifikasi gabungan per 6 jam.

Env: `JOURNEY_SYNC_KEY` (string acak ≥ 32 karakter, sama dengan `CRM_SYNC_KEY` di project journey).

## Cron

| Job | Jadwal (UTC) | Fungsi |
| --- | --- | --- |
| `/api/cron/task-reminders` | 00:00 (07:00 WIB) | Pengingat tugas ≤ 24 jam & terlambat (tidak dobel dalam 20 jam) |
| `/api/cron/pending-visit-fees` | 01:00 (08:00 WIB) | Ingatkan approver soal visit fee > 24 jam |
| `/api/cron/daily-digest` | 23:30 (06:30 WIB) | Ringkasan harian untuk Executive & Sales Manager (sekali per hari) |
| `/api/cron/expire-quotations` | 17:05 (00:05 WIB) | Quotation *sent* yang lewat *valid until* → *expired* (tercatat di audit trail sebagai System) |

Semua job butuh header `Authorization: Bearer $CRON_SECRET`. Vercel Cron mengirim header ini otomatis bila `CRON_SECRET` diset.

## Pindah ke Google Cloud BOEMI

1. **Database:** buat Cloud SQL PostgreSQL (region `asia-southeast2` Jakarta), lalu `pg_dump` dari Neon → `pg_restore` ke Cloud SQL (atau mulai bersih dengan `npm run db:migrate`).
2. **Storage:** buat bucket Cloud Storage (private), set `STORAGE_DRIVER=gcs` dan `GCS_BUCKET`. Salin file dari Blob bila perlu.
3. **Deploy:** `docker build` → Artifact Registry → Cloud Run. Pasang service account dengan akses Cloud SQL + bucket. Simpan secret di Secret Manager.
4. **Cron:** buat 4 job Cloud Scheduler (lihat tabel di atas) dengan header Authorization yang sama.
5. **Domain:** arahkan domain ke Cloud Run, set `APP_URL`.

## Belum dikerjakan (berikutnya)

- Projects 5b–5e: view Kanban, Timeline/Gantt, Calendar, Workload, Dashboard, My Work, automasi; approval project_budget & purchase_request
- PDF untuk sales order / invoice (saat ini hanya quotation)
- Scoring kualifikasi (rule-based dari `qualification_criteria` + Gemini/Vertex AI untuk catatan kunjungan)
- Rate limit login, reset password, login Google Workspace
