# Audit akhir Fase 1

Tanggal: 11 November 2026 · commit dasar `c734423` + perbaikan audit ini · lingkungan uji: build production (`next build`, standalone) + PostgreSQL (pglite) dengan data seed dummy.

> **Catatan sumber:** dokumen *Application Sitemap & Functional Scope v2.0* tidak tersedia di sesi ini. Checklist di bawah disusun dari spesifikasi Batch 1–7 (yang mengikuti v2.0), Access Matrix v2.0 di README, dan kode yang ada. Cocokkan sekali lagi dengan dokumen v2.0. Baris yang tidak ada di sini tapi ada di v2.0 = **belum**.

Legenda: ✅ ada · 🟡 sebagian · ⬜ belum

## Ringkasan

| Modul | ✅ | 🟡 | ⬜ |
| --- | :-: | :-: | :-: |
| Dashboard & Workspace | 8 | 1 | 1 |
| CRM & Sales | 19 | 1 | 0 |
| Project Management | 11 | 2 | 4 |
| User & RBAC | 8 | 1 | 2 |
| Reporting dasar | 9 | 1 | 0 |

- **Uji akses:** **424/424 lulus**. Ini mencakup 364 kombinasi halaman × role, 10 akses record lewat URL, 11 API, dan 39 server action yang dipanggil langsung tanpa UI.
- **Siap Google Cloud:** ya. Tidak ada ketergantungan Vercel/Neon di logika bisnis; semua env terdokumentasi; 6 job Cloud Scheduler punya script.

## 1. Checklist halaman & fitur

### Dashboard & Workspace

| Fitur | Status | Halaman | File utama | Catatan |
| --- | :-: | --- | --- | --- |
| Overview: revenue vs target, pipeline, forecast, leads 30 hari, needs attention | ✅ | `/dashboard` | `src/app/(app)/dashboard/page.tsx` | Sales hanya datanya sendiri |
| Kartu Executive: projects & approval pending | ✅ | `/dashboard` | `src/lib/reports/projects.ts` | Hanya Executive & Admin |
| Kartu Contact Today | ✅ | `/dashboard` | `src/lib/qualification/contact.ts` | Role yang boleh membuka Contact Today |
| Approvals inbox + riwayat | ✅ | `/approvals` | `src/lib/approvals.ts`, `src/app/actions/approvals.ts` | Badge di menu |
| Calendar (month/week/agenda, filter Me/Team/Everyone) | 🟡 | `/calendar` | `src/lib/calendar/*` | Sinkron Google Calendar baru interface (`src/lib/calendar/sync.ts`) |
| Team & Sales KPI | ✅ | `/dashboard/team` | `src/lib/queries/sales.ts` | |
| Global search (Ctrl/Cmd+K) | ✅ | header | `src/lib/queries/search.ts`, `src/components/shell/command-palette.tsx` | Scope sama dengan daftar |
| Notifikasi in-app, email, push + preferensi | ✅ | `/notifications`, `/profile` | `src/lib/notifications/*`, `src/lib/push.ts` | WhatsApp ditolak klien; Google Chat menunggu Workspace |
| My profile (foto, password, notifikasi) | ✅ | `/profile` | `src/app/actions/profile.ts` | |
| My Work (task sales + item board) | ⬜ | — | — | Direncanakan 5e |

### CRM & Sales

| Fitur | Status | Halaman | File utama | Catatan |
| --- | :-: | --- | --- | --- |
| Leads: tambah, assign, contacted, qualify → account + deal, disqualify | ✅ | `/sales/leads` | `src/app/actions/leads.ts` | Cek duplikat HP/email |
| Lead qualification (rules + AI opsional, skor/tier/alasan, override) | ✅ | `/sales/leads`, detail akun | `src/lib/qualification/*` | AI aktif setelah env diset |
| Contact Today + SLA + notifikasi | ✅ | `/sales/contact-today` | `src/lib/qualification/contact.ts` | |
| Webhook journey → lead | ✅ | `POST /api/leads/journey` | `src/lib/journey.ts` | |
| Accounts + detail 360° | ✅ | `/database/accounts`, `/database/accounts/[id]` | `src/app/actions/accounts.ts` | |
| Contacts | ✅ | `/database/contacts` | `src/app/actions/contacts.ts` | |
| Activity log (call/WA/email/meeting/note) | ✅ | detail akun | `src/app/actions/activities.ts` | |
| Pipeline (drag stage, lost reason) | ✅ | `/sales/pipeline` | `src/app/actions/pipeline.ts` | Probability efektif dari Master Data |
| Sales Forecast (weighted/commit/best case vs target & actual) | ✅ | `/sales/forecast` | `src/lib/reports/forecast.ts` | Override probability per deal |
| Quotation + tier harga + diskon approval + PDF | ✅ | `/sales/quotations`, `/print/quotations/[id]` | `src/app/actions/quotations.ts` | |
| Orders + pembayaran + pengiriman | 🟡 | `/sales/orders`, `/sales/orders/[id]` | `src/app/actions/orders.ts` | PDF sales order / invoice belum |
| Visits (GPS + foto) + visit fee approval | ✅ | `/sales/visits` | `src/app/actions/visits.ts` | |
| Tasks & follow-up (kanban + log) | ✅ | `/sales/tasks` | `src/app/actions/tasks.ts` | |
| Targets per rep × metrik | ✅ | `/sales/targets` | `src/app/actions/targets.ts` | |
| Products & price list (tier otomatis) | ✅ | `/database/products` | `src/lib/pricing.ts` | |
| Employees | ✅ | `/database/employees` | — | |
| Import / Export CSV | ✅ | `/database/import`, `/api/export/*` | `src/lib/import/*` | |
| Campaigns, lead sources & attribution, content calendar | ✅ | `/marketing/*` | `src/app/actions/marketing.ts`, `content.ts` | |
| Events, lead capture, ROI | ✅ | `/event/*` | — | |
| Audit trail semua create/update/delete/approve/export | ✅ | `/settings/audit` | `src/lib/audit.ts` | |

### Project Management (gaya monday.com)

| Fitur | Status | Halaman | File utama | Catatan |
| --- | :-: | --- | --- | --- |
| Boards & projects per workspace (departemen), kode PRJ | ✅ | `/projects` | `src/app/actions/boards.ts` | |
| Table view (inline edit, grup, subitem, drag, bulk, kolom custom, label + kategori) | ✅ | `/projects/[boardId]` | `src/components/board-table/*` | |
| Kanban | ✅ | `?view=kanban` | `kanban-view.tsx` | |
| Timeline / Gantt + dependency FS/SS/FF/SF, strict/flexible | ✅ | `?view=timeline` | `timeline-view.tsx`, `src/lib/boards/dependency-rules.ts` | |
| Calendar | ✅ | `?view=calendar` | `calendar-view.tsx` | |
| Workload | ✅ | `?view=workload` | `workload-view.tsx` | Kapasitas belum disimpan per orang |
| Dashboard board | ✅ | `?view=dashboard` | `dashboard-view.tsx` | |
| Akses board (owner/editor/edit-own-only/viewer, visibility) | ✅ | — | `src/lib/boards/access.ts` | |
| Approval project (Approval Engine) | ✅ | header board | `src/lib/approvals.ts` | |
| File per item | ✅ | kolom Files | `uploadItemFile` | |
| Activity log per item | ✅ | panel item | `board_item_activity` | |
| Subitem di Timeline/Calendar/Workload | 🟡 | — | — | Hanya di Table, Kanban dan panel item |
| Simpan view/filter per board | 🟡 | — | `board_views` | Filter di URL; tabel view baru berisi "Main Table" |
| Template board | ⬜ | — | enum `template` | Belum ada UI |
| Komentar / updates per item | ⬜ | — | — | |
| Automasi | ⬜ | — | — | |
| Approval `project_budget` & `purchase_request` | ⬜ | — | tipe sudah ada di engine | Outcome belum dihubungkan |

### User & RBAC

| Fitur | Status | Halaman | File utama | Catatan |
| --- | :-: | --- | --- | --- |
| Users & Roles (9 role Access Matrix v2.0), aktif/nonaktif | ✅ | `/settings/users` | `src/app/actions/users.ts` | Super Admin terakhir tidak bisa dinonaktifkan |
| Departments & teams (kepala, sub-departemen) | ✅ | `/settings/departments` | `src/app/actions/departments.ts` | |
| Scope data all / team / own | ✅ | semua daftar, search, export | `src/lib/scope.ts`, `src/lib/customers.ts` | |
| Guard halaman di server (menu = aturan yang sama) | ✅ | semua halaman berbatas role | `src/components/page/guard.tsx`, `src/lib/nav.ts` | Diuji 364 kombinasi |
| Approval workflows (multi-step, simulasi) | ✅ | `/settings/approvals` | `src/app/actions/approval-flows.ts` | |
| Sesi: logout paksa saat role/password berubah, wajib ganti password | ✅ | `/change-password` | `src/lib/session.ts` | |
| Reset password oleh admin | 🟡 | `/settings/users` | `resetUserPassword` | Self-service "lupa password" belum |
| Master data (kriteria kualifikasi, probability stage, tier & SLA) | ✅ | `/settings/master-data` | | |
| Document templates, Integrations, Google Cloud | ✅ | `/settings/*` | | |
| Login Google Workspace | ⬜ | — | `users.auth_provider`, `google_sub` | Menunggu Workspace BOEMI |
| Rate limit login | ⬜ | — | — | Disarankan sebelum go-live (Cloud Armor atau tabel percobaan) |

### Reporting dasar

| Laporan | Status | Halaman | Export CSV |
| --- | :-: | --- | :-: |
| Sales (channel, rep, produk) | ✅ | `/report/sales` | — |
| Pipeline & funnel | ✅ | `/report/funnel` | — |
| Receivables & deposits | ✅ | `/report/receivables` | — |
| Marketing & event ROI | ✅ | `/report/marketing` | — |
| Visits & fees | ✅ | `/report/visits` | — |
| Project performance | ✅ | `/report/projects` | ✅ |
| Department KPI | ✅ | `/report/departments` | ✅ |
| Sales forecast | ✅ | `/sales/forecast` | ✅ |
| Executive dashboard | ✅ | `/dashboard` | — |
| Export CSV untuk laporan Batch 1–4 | 🟡 | — | Hanya data mentah (orders, leads, accounts…) lewat `/api/export/*` |

## 2. Matriks akses (diuji di server)

**Cara uji:**
- Tiap role memakai akun seed-nya, dengan cookie sesi asli.
- Halaman diminta langsung lewat HTTP.
- Server action dipanggil langsung (`Next-Action` + argumen hasil `encodeReply`), tanpa membuka UI. Tujuannya membuktikan bahwa penolakan terjadi di server, bukan hanya karena tombol disembunyikan.

Script uji ada di luar repo (lingkungan uji pglite + cookie seed). Hasil: **424/424 lulus**.

### Halaman berbatas role

| Halaman | Admin | Exec | Dept Head | Finance | PM | Sales | Mkt | Designer | Staff |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `/sales/contact-today` | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ |
| `/report/sales` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/report/funnel` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/report/receivables` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/report/marketing` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/report/projects` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/report/departments` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/report/visits` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/settings/users` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/settings/departments` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/settings/approvals` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/settings/master-data` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/settings/templates` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/settings/integrations` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/settings/google-cloud` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `/settings/audit` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Terbuka untuk semua role (isi tetap difilter scope data): `/dashboard`, `/approvals`, `/calendar`, `/dashboard/team`, `/sales/leads`, `/sales/pipeline`, `/sales/forecast`, `/sales/quotations`, `/sales/orders`, `/sales/visits`, `/sales/tasks`, `/sales/targets`, `/marketing/campaigns`, `/marketing/attribution`, `/marketing/content`, `/projects`, `/event/list`, `/event/leads`, `/event/roi`, `/database/accounts`, `/database/contacts`, `/database/products`, `/database/employees`, `/database/import`

- Role yang tidak berhak mendapat halaman *"Your role doesn't have access to this page"* dari server, bukan hanya menu yang disembunyikan.
- Modul Phase 2+ (`/ecommerce`, `/store`, `/consignment`) dialihkan ke `/dashboard` di proxy.
- Tanpa sesi → `/login`.

### Record, API dan server action

| Area | Uji | Hasil | Jawaban server |
| --- | --- | :-: | --- |
| record | sales     rep opens another rep's account | ✅ | 200 |
| record | dewi      rep opens own account | ✅ | 200 |
| record | manager   department head opens team account | ✅ | 200 |
| record | sales     rep opens another rep's quotation | ✅ | 200 |
| record | sales     rep prints another rep's quotation | ✅ | 200 |
| record | sales     rep opens another rep's order | ✅ | 200 |
| record | finance   finance opens a Sales-department project (not a member) | ✅ | 200 |
| record | staff     staff opens own-department project (view) | ✅ | 200 |
| record | finance   finance opens Marketing team board | ✅ | 200 |
| record | designer  designer opens board they're a member of | ✅ | 200 |
| api | export projects: sales → 403 | ✅ | 403 |
| api | export departments: staff → 403 | ✅ | 403 |
| api | export receivables-type report: finance projects → 403 | ✅ | 403 |
| api | export projects: department head → 200 | ✅ | 200 |
| api | export orders: sales → own rows only | ✅ | 200 |
| api | export leads: sales → own rows only | ✅ | 200 |
| api | export: no session → redirect/401 | ✅ | 307 |
| api | cron without secret → 401 | ✅ | 401 |
| api | cron with wrong secret → 401 | ✅ | 401 |
| api | journey webhook without key → 401 | ✅ | 401 |
| api | health check public | ✅ | 200 |
| action | createUser as Department Head | ✅ | Only a Super Admin can manage users. |
| action | createUser as Sales | ✅ | Only a Super Admin can manage users. |
| action | setUserActive as Executive | ✅ | Only a Super Admin can manage users. |
| action | resetUserPassword as Finance | ✅ | Only a Super Admin can manage users. |
| action | updateDepartment as Executive | ✅ | Only a Super Admin can manage departments. |
| action | saveApprovalFlow as Department Head | ✅ | Only a Super Admin can change approval workflows. |
| action | deleteApprovalFlow as Sales | ✅ | Only a Super Admin can change approval workflows. |
| action | saveCriterion as Department Head | ✅ | Only Super Admin can change qualification criteria. |
| action | deleteCriterion as Executive | ✅ | Only Super Admin can change qualification criteria. |
| action | rescoreAll as Sales | ✅ | Only Super Admin can re-score everything. |
| action | saveSettings (document templates) as Sales | ✅ | Only admins and sales managers can change document settings. |
| action | saveSettings (stage probabilities) as Marketing | ✅ | Only admins and sales managers can change document settings. |
| action | createProduct as Sales | ✅ | Only admins and sales managers can change the price list. |
| action | deleteProduct as Marketing | ✅ | Only admins and sales managers can change the price list. |
| action | saveTargets as Sales | ✅ | Only admins and sales managers can set targets. |
| action | decideApproval (visit fee) as Sales (not an approver) | ✅ | You can't decide on your own request. |
| action | updateAccount of another rep's account | ✅ | Only the account owner or a manager can edit this account. |
| action | deleteContact on another rep's account | ✅ | Only the account owner or a manager can delete contacts. |
| action | deleteQuotation of another rep | ✅ | Only the owner or a manager can delete this quotation. |
| action | deleteOrder of another rep | ✅ | Only the order owner or a manager can delete it. |
| action | recordPayment as Designer | ✅ | Only the order owner, finance or a manager can record payments. |
| action | setDealProbability on another rep's deal | ✅ | Only the deal owner or a sales manager can change its probability. |
| action | moveDeal on another rep's deal | ✅ | Only the deal owner or a sales manager can move this deal. |
| action | overrideTier on another rep's lead | ✅ | Not found. |
| action | rescore another rep's lead | ✅ | Not found. |
| action | (control) rescore own lead is allowed | ✅ | 0:{"a":"$@1","q":"","i":false,"b":"tpsR9EWcXC1oLmOclmxdL"}
1:{"ok":true,"message |
| action | loadScoreDetails of another rep's lead → null | ✅ | 0:{"a":"$@1","q":"","i":false,"b":"tpsR9EWcXC1oLmOclmxdL"} 1 |
| action | markLeadContacted on another rep's lead | ✅ | You can't update this lead. |
| action | createBoard as Sales | ✅ | Your role can't create boards. |
| action | archiveBoard as Designer (editor) | ✅ | Only the board owner, the department head or an admin can archive it. |
| action | saveBoardMember as Staff (viewer) | ✅ | Only the board owner, the department head or an admin can change members. |
| action | updateColumn as Designer (editor, not owner) | ✅ | Only board owners can change columns. |
| action | deleteGroup as Sales (editor) | ✅ | Only board owners can delete groups. |
| action | updateItemField on an item not assigned to Designer (edit-own-only) | ✅ | You can only edit items assigned to you. |
| action | bulk delete as Sales (editor, not owner) | ✅ | Only board owners can delete items — archive them instead. |
| action | createItem as Staff (view only) | ✅ | You can't add items to this board. |
| action | itemDetail by Finance (no board access) → null | ✅ | 0:{"a":"$@1","q":"","i":false,"b":"tpsR9EWcXC1oLmO |
| action | import Employees as Department Head | ✅ | Only admins can import employees. |
| action | server action without a session → redirected, not run | ✅ | 307 → /login?next=%2Fdashboard |

## 3. Siap pindah ke Google Cloud

| Cek | Hasil |
| --- | --- |
| Logika bisnis bebas Vercel/Neon | ✅ Tidak ada `@vercel/*`, `process.env.VERCEL` atau API Neon di logika bisnis. Yang khusus staging hanya driver `vercel-blob` (dipilih lewat `STORAGE_DRIVER`), `vercel.json` dan script `vercel-build`. Database memakai driver `postgres` standar. |
| Env terdokumentasi | ✅ Semua `process.env.*` di `src/` dan `scripts/` ada di `.env.example` dan di tabel README. Dicek otomatis. **Diperbaiki:** `.env.example` sebelumnya tidak ada, padahal README menyuruh `cp .env.example .env`. |
| Cron → Cloud Scheduler | ✅ 6 job didokumentasikan (path, jadwal WIB, header `Authorization: Bearer CRON_SECRET`). **Baru:** `deploy/cloud-scheduler.sh` membuat/memperbarui job dengan zona waktu Asia/Jakarta; dry-run dengan `gcloud` palsu menunjukkan argumen yang benar. |
| Migrasi tanpa seed | ✅ **Baru:** stage `migrate` di `Dockerfile` untuk Cloud Run Job. Isi image disimulasikan pada database kosong → migrasi 0000–0011 lulus. Image belum dibangun di sini karena Docker daemon tidak tersedia. |
| Admin pertama di production | ✅ **Baru:** `npm run admin:create`, tanpa data demo. Diuji: tolak password < 12 karakter, buat admin, reset admin. |
| Health check | ✅ `GET /api/health` (cek DB, 503 bila mati) |
| Storage | ✅ Driver `gcs` dengan kredensial service account, tanpa file key |
| AI | ✅ Provider `vertex` memakai token metadata server Cloud Run |
| Catatan Cloud Run | ⚠️ Antrian skor memakai `after()`. Dengan CPU throttling (default), pekerjaan setelah respons bisa tertunda, jadi pakai `--no-cpu-throttling` atau andalkan cron 5 menit. Sudah ditulis di README. |
| Halaman Setting → Google Cloud | **Diperbaiki:** sekarang menampilkan lingkungan sebenarnya (Cloud Run lewat `K_SERVICE`, status AI), bukan teks "Vercel" yang tertanam. |

## 4. Perbaikan dalam audit ini

- `updateContact`: `verifyUser()` sekarang dipanggil sebelum membaca database. Sebelumnya cek akses terjadi sesudah satu query, tanpa kebocoran data.
- `.env.example` dibuat.
- Stage `migrate` ditambahkan di `Dockerfile`.
- Ditambahkan `deploy/cloud-scheduler.sh` dan `scripts/create-admin.ts` (`npm run admin:create`).
- README: tabel Cron (WIB + UTC), langkah Google Cloud, tabel env.
- Halaman Google Cloud menampilkan lingkungan yang sebenarnya.

## 5. Sisa sebelum go-live (rekomendasi)

1. Cocokkan checklist ini dengan dokumen Sitemap v2.0.
2. Tambah rate limit login dan alur "lupa password" (atau langsung Google Workspace sign-in).
3. PDF sales order / invoice bila diminta di UAT.
4. Nyalakan `QUALIFICATION_AI` di staging dan bandingkan skor dengan penilaian tim sales sebelum ambang tier dikunci.
5. UAT per role: `docs/UAT.md`.
