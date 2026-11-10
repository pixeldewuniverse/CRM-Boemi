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

Kenapa tabel `activities` terpisah dari `tasks`: task = pekerjaan yang **akan** dilakukan (assignee, deadline, pengingat, board Kanban, KPI "overdue"); activity = catatan yang **sudah** terjadi. Memakai `tasks` untuk log akan mengotori board & pengingat dan butuh banyak kolom kosong. Aktivitas tetap ikut dihitung di KPI *activities* rep.

Nomor dokumen dibuat atomik di `document_counters` (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), jadi dua user yang menyimpan bersamaan tidak mendapat nomor yang sama. Semua create/update/delete/approve/payment tercatat di **Setting → Audit Trail**.

## Data demo

`src/db/seed.ts` mengisi data dummy dari demo (`src/db/demo/demo-data.json`): 8 user persona, 12 akun, 14 produk, lead, deal, quotation, order + riwayat 12 bulan, visit, task, target, campaign, event, konten. Tanggal digeser supaya "hari ini" di demo = hari seed dijalankan.

Data Batch 1 (`ensureBatch1Demo`, aman dijalankan berulang — juga mengisi database staging yang sudah di-seed sebelumnya): satuan produk, catatan kontak, 13 log aktivitas, target 4 metrik (bulan ini & lalu), riwayat pembayaran deposit/pelunasan, status pengiriman, data perusahaan dummy untuk PDF, counter nomor dokumen yang melanjutkan nomor demo, 1 quotation draft dengan diskon 15% yang menunggu approval manager, tautan campaign di beberapa akun.

Login demo (password = `SEED_ADMIN_PASSWORD` saat seed pertama): `admin@`, `manager@`, `sales@`, `dewi@`, `putu@`, `marketing@`, `finance@`, `designer@example.test`.

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

- Batch 2–4: User & RBAC, Project Management (Gantt/kalender), Workspace & Reporting, approval engine (memindahkan approval diskon quotation)
- PDF untuk sales order / invoice (saat ini hanya quotation)
- Bulk import/export CSV
- Scoring kualifikasi (rule-based dari `qualification_criteria` + Gemini/Vertex AI untuk catatan kunjungan)
- Rate limit login, reset password, login Google Workspace
