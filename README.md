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
cp .env.example .env          # isi DATABASE_URL, SESSION_SECRET, CRON_SECRET, SEED_ADMIN_PASSWORD (STORAGE_DRIVER=local)
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
| `npm run db:seed` | Isi data dummy (staging saja) |
| `npm run admin:create` | Buat/reset Super Admin di database production kosong (`ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`) |

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
- **E-Commerce, Store (Later) dan Consignment (Add-on)** — modul Phase 2 dan selanjutnya — **disembunyikan** untuk sekarang: tidak muncul di menu dan pencarian, URL-nya dialihkan ke Dashboard (`src/proxy.ts`). Halamannya (data contoh statis dari `src/lib/preview.ts`) tetap ada di kode; tampilkan lagi dengan `SHOW_LATER_PHASES = true` di `src/lib/nav.ts`.
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
- **Kanban** (`/projects/[boardId]?view=kanban`, tab di atas tabel): satu lajur per label status (pilih kolom status lain lewat *Lanes* bila board punya lebih dari satu), kartu berisi grup, prioritas, subitem, orang dan due date. Drag kartu = ubah status (aturan edit sama dengan tabel, termasuk *edit own only*), klik kartu = panel item. Filter/cari/sort ikut pindah antara Table dan Kanban. Maks 500 item.
- **Timeline / Gantt** (`?view=timeline`, CSS grid + SVG tanpa library): bar per item berwarna status, ◆ milestone, garis hari ini, zoom hari/minggu/bulan, panah dependency (merah putus-putus = urutan dilanggar). Drag bar = geser tanggal, drag tepi = ubah mulai/selesai, keyboard ←/→ geser sehari, Shift+←/→ ubah tanggal selesai; klik bar = panel item. Mode dependency board: **flexible** = tetap disimpan + toast peringatan, **strict** = server menolak perubahan tanggal yang melanggar (juga saat menambah dependency), **none** = tanpa cek. Aturan FS/SS/FF/SF + lag di `src/lib/boards/dependency-rules.ts` (dipakai server & browser). Item tanpa tanggal dihitung dan bisa dibuka dari daftar kiri.
- **Calendar** (`?view=calendar`): grid bulan (Senin–Minggu), item di tanggal due-nya (warna status, ◆ milestone, garis merah = terlambat). Drag ke hari lain = start & due bergeser bersama (durasi tetap; board strict tetap dicek server). HP: daftar agenda per tanggal.
- **Workload** (`?view=workload`): jam estimasi per orang per minggu (8 minggu, mulai minggu ini) untuk item yang belum Done. Estimasi dibagi rata ke hari kerja dan ke assignee. Kapasitas 20/32/40 jam/minggu; ≤ 80% hijau, 80–100% oranye, > 100% merah dengan "!". Klik sel = daftar item penyebabnya; kolom "No dates" untuk item tanpa tanggal.
- **Dashboard** (`?view=dashboard`): % done, item terbuka + sisa jam, overdue, stuck, due 14 hari; komposisi status; progress per grup; item terbuka per orang; budget project (budget, biaya aktual, total kolom angka ber-prefix Rp); daftar overdue, due 14 hari dan milestone. Semua view mengikuti filter toolbar dan maks 500 item.
- **Toolbar**: cari, filter orang/status/grup/tanggal, sort, group-by (status/prioritas/orang = grup virtual, maks 500 item, tanpa drag), kolom (owner: show/hide + urutan untuk semua; user lain: sembunyikan untuk diri sendiri lewat URL). Semua tersimpan di URL.
- **Skala**: 50 item per grup + *Show more*; ringkasan dihitung di database atas semua item yang cocok. Posisi pecahan (`double`) + renumber otomatis.
- **Konflik**: last-write-wins; bila orang lain mengubah item setelah halaman dimuat, perubahan tetap tersimpan dan muncul toast "X also changed …".
- **Dependency** FS/SS/FF/SF + lag hari; loop ditolak (CTE rekursif). Mode strict/flexible/none diatur di *Edit details* (lihat Timeline).
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

### Reporting dasar (Batch 6)

- **Sales Forecast** (`/sales/forecast`, menu Sales; kartu *Forecast* di Overview): per bulan berdasarkan `expected_close_on`, per rep & total, 3/6/12 bulan ke depan.
  - **Target** = `kpi_targets` metric `revenue`; **Actual** = order (tanpa cancelled) per bulan; **Best case** = semua deal terbuka; **Commit** = deal dengan probability ≥ 75%; **Weighted** = nilai × probability; **Projected** = actual + weighted.
  - Probability default per stage diatur di **Setting → Master Data** (`app_settings.pipeline`; Won 100%, Lost 0%). Deal boleh override di tabel forecast (kosongkan = kembali ke default); kolom baru `opportunities.probability_override`. Pipeline & funnel ikut memakai probability efektif ini.
  - Deal dengan tanggal close yang sudah lewat atau tanpa tanggal tidak dihitung, dan disebutkan di atas grafik.
  - Scope sama dengan pipeline: sales melihat deal sendiri, Department Head timnya, Executive/Admin semua.
- **Project Performance** (`/report/projects`): dari board `kind=project` yang boleh dilihat user — progress (kategori status Done), on-time (item Done yang selesai ≤ due date), item overdue, project terlambat (masih terbuka & lewat due date), budget vs biaya aktual; ringkasan per departemen.
- **Department KPI** (`/report/departments`, periode bulan ini / bulan lalu / kuartal / tahun): per departemen — orang, revenue, won/lost & win rate, leads & konversi ke qualified, project & on-time, task sales + item project yang overdue. Panel Marketing: leads per sumber; untuk Admin/Executive juga biaya marketing (biaya aktual event + budget campaign yang mulai di periode) dan biaya per lead. Department Head hanya melihat departemen yang ia pimpin.
- **Executive Dashboard**: untuk Executive & Admin, Overview menambah kartu **Projects** (open, late, rata-rata progress, item overdue, 5 project paling berisiko) dan **Waiting for approval** (semua request pending, paling lama di atas). Tampilan sales tidak berubah selain kartu Forecast.
- **Export CSV**: `/api/export/forecast?months=&rep=`, `/api/export/projects`, `/api/export/departments?range=` — scope sama dengan halaman; laporan Report mengikuti aturan role menunya (403 bila tidak boleh) dan tercatat di Audit Trail.

Grafik memakai komponen yang sudah ada (`ColumnChart`/`BarList`, `Meter` — kini dengan mode `spend` untuk budget, `Stats`). Migrasi Batch 6: `drizzle/0010_forecast_probability.sql`. Seed (`ensureBatch6Demo`): target revenue 3 bulan ke depan, 2 deal dengan probability sendiri, project terlambat & over budget (Website Relaunch, Marketing) dan project selesai tepat waktu (Sanur Spa pilot).

### Lead qualification (Batch 7)

Prinsip: **aturan pasti dihitung kode, AI hanya menilai teks bebas, skor akhir tetap dihitung kode.** Semua lead tetap dihubungi — skor hanya menentukan **urutan**.

- **Engine** `src/lib/qualification/`:
  - `core.ts` (murni, tanpa DB/jaringan): evaluasi rule, redaksi teks, validasi AI, skor/tier/alasan, versi kriteria, prioritas kontak.
  - `engine.ts`: muat lead/account → lapis 1 + lapis 2 → simpan `qualification_runs` → update record. Dipakai app dan seed.
  - `providers.ts`: Gemini API / Vertex AI / mock. `queue.ts`: antrian background. `contact.ts`: Contact Today + cron SLA.
- **Lapis 1 (kode)**: kriteria `rule` di `qualification_criteria` (operator: equals, is not, is one of, ≥, ≤, contains, is filled in) atas segment, city, region (diturunkan dari kota), source, marketing consent, `interests.*`, decision maker (khusus account).
- **Lapis 2 (AI, opsional)**: kriteria `ai` dengan rubrik 0–3. Sumber teks: catatan lead, jawaban aroma journey, catatan visit & activity.
  - Output wajib JSON schema `{criteria: [{criterionId, score 0–3, evidence, unknown}], missingInfo[], suggestedNextAction}`.
  - Evidence harus kutipan **persis** dari teks yang dikirim (dicek kode); kalau bukan kutipan → `unknown`.
  - **Unknown tidak dihitung sebagai 0** (dikeluarkan dari pembagi, sama seperti AI mati) dan masuk ke "Ask next" — jadi lead dengan catatan pendek tidak dihukum.
- **Privasi (UU PDP)**: yang dikirim hanya segment, kota, region, source, consent, `interests` yang di-whitelist dan teks yang sudah diredaksi. Nama perusahaan/PIC/kontak, HP, email dan @handle diganti `[company]`/`[name]`/`[phone]`/`[email]`/`[handle]`; nama, HP, email, Instagram dan tanggal lahir lead tidak pernah dikirim. Daftar field yang dikirim tersimpan di setiap run.
- **Skor** = bobot yang didapat ÷ bobot yang berlaku × 100 (AI: bobot × skor/3). Tier: **hot ≥ 70, warm ≥ 40**, sisanya cold (bisa diubah di Master Data). Alasan = 3 penyumbang terbesar.
- **Pemicu** (semuanya lewat antrian `qualification_jobs`, diproses setelah respons dengan `after()` — request tidak menunggu — plus cron sebagai pengaman, retry 3×):
  - lead dibuat: form, import, webhook journey;
  - account dibuat, diedit, atau hasil konversi lead;
  - visit atau activity baru;
  - tombol **Re-score** (langsung) dan **Re-score all** di Master Data.
- **Jejak**: `qualification_runs` menyimpan versi kriteria (hash), snapshot kriteria, hasil per kriteria, provider/model/durasi, output AI tervalidasi atau error, field yang dikirim, skor/tier/alasan dan pemicunya.
- **Override tier**: owner/manager/admin, alasan wajib (≥ 10 karakter), tercatat di Audit Trail. Re-score tetap menghitung skor, tapi tier override tetap dipakai sampai dikembalikan ke "computed".
- **Contact Today** (`/sales/contact-today`, menu Sales + kartu di Dashboard):
  - Isi: semua lead *new/contacted* dalam scope user.
  - Urutan = skor + 2 poin per hari menunggu (maks +30) + 20 bila SLA lewat.
  - SLA: hot 1 hari, warm 3, cold 7, dihitung dari kontak terakhir (atau tanggal lead masuk).
  - Tombol *Contacted* mencatat `last_contacted_at` dan memulai jendela baru.
  - Cron `lead-sla` mengirim notifikasi `lead.sla` ke owner (lead tanpa owner → manager), lalu eskalasi ke manager bila lewat +1 hari.
- **Fallback**: AI mati / error / timeout 20 dtk → lapis 1 tetap disimpan (kriteria AI tidak dihitung), run diberi tanda "AI unavailable", dan dicoba ulang 30 menit kemudian. Lead tetap masuk antrian kontak.
- **Master Data**: kriteria bisa ditambah/diedit/dinonaktifkan/dihapus (run lama menyimpan salinannya), ambang tier & SLA, status lapis AI, **Re-score all**.

**Env**:

| Variabel | Fungsi |
| --- | --- |
| `QUALIFICATION_AI=on` | Nyalakan lapis 2; tanpa ini hanya rules. |
| `QUALIFICATION_AI_PROVIDER` | `gemini` (staging) atau `vertex` (production). `mock` hanya untuk tes/demo, tanpa jaringan. |
| `GEMINI_API_KEY` | Untuk provider `gemini`; dikirim di header, bukan URL. |
| `VERTEX_PROJECT`, `VERTEX_LOCATION` | Untuk provider `vertex`. Location default `asia-southeast1`. Auth memakai service account Cloud Run lewat metadata server — tanpa file key; beri role *Vertex AI User*. |
| `QUALIFICATION_MODEL` | Default `gemini-2.5-flash-lite`. |

Tanpa library baru (pakai `fetch`). Migrasi Batch 7: `drizzle/0011_qualification.sql`.

Seed (`ensureBatch7Demo`):
- 3 kriteria AI contoh;
- skor awal semua lead/account memakai **demo AI tersimulasi** (diberi label begitu di UI);
- beberapa follow-up yang lewat SLA;
- satu tier yang di-override beserta alasannya.

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

Semua job adalah `GET /api/cron/<job>` dengan header **`Authorization: Bearer $CRON_SECRET`** (tanpa header / salah → 401).

| Job | Cloud Scheduler (WIB, `Asia/Jakarta`) | Vercel Cron (staging, UTC) | Fungsi |
| --- | --- | --- | --- |
| `/api/cron/task-reminders` | `0 7 * * *` — 07:00 | `0 0 * * *` | Pengingat tugas ≤ 24 jam & terlambat (tidak dobel dalam 20 jam) |
| `/api/cron/pending-visit-fees` | `0 8 * * *` — 08:00 | `0 1 * * *` | Ingatkan approver soal permintaan > 24 jam |
| `/api/cron/daily-digest` | `30 6 * * *` — 06:30 | `30 23 * * *` | Ringkasan harian untuk Executive & Department Head |
| `/api/cron/expire-quotations` | `5 0 * * *` — 00:05 | `5 17 * * *` | Quotation *sent* lewat *valid until* → *expired* |
| `/api/cron/qualification-queue` | `*/5 * * * *` — tiap 5 menit | `20 0 * * *` | Sisa antrian skor lead/account, retry AI, bersihkan job lama |
| `/api/cron/lead-sla` | `10 8-20 * * *` — tiap jam 08:10–20:10 | `0 1 * * *` | Lead lewat SLA kontak → owner, +1 hari → manager |

- **Cloud Scheduler**: `deploy/cloud-scheduler.sh` membuat/memperbarui keenam job (nama `smt-<job>`, zona waktu Asia/Jakarta, header Bearer). Contoh pemakaian ada di kepala file.
- **Vercel**: terdaftar di `vercel.json`. Vercel Hobby hanya boleh cron harian, jadi antrian & SLA di staging sekali sehari; antrian tetap diproses langsung lewat `after()`.

## Pindah ke Google Cloud BOEMI

Logika bisnis tidak bergantung pada Vercel/Neon. Yang khusus staging hanya bisa diganti lewat env:

| Bagian | Staging | Production | Cara ganti |
| --- | --- | --- | --- |
| Database | Neon (pooled + unpooled) | Cloud SQL PostgreSQL | `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED` untuk migrasi). Driver `postgres` standar; `prepare: false` aman di keduanya. |
| File | Vercel Blob privat | Cloud Storage privat | `STORAGE_DRIVER=gcs` + `GCS_BUCKET`. Kredensial dari service account, tanpa file key. |
| Cron | `vercel.json` | Cloud Scheduler | `deploy/cloud-scheduler.sh`, header & path sama. |
| AI kualifikasi | Gemini API | Vertex AI | `QUALIFICATION_AI_PROVIDER=vertex` + `VERTEX_PROJECT`/`VERTEX_LOCATION`. |
| Build | `vercel-build` (migrate + seed opsional) | `Dockerfile` (tanpa seed) | — |

`vercel.json`, script `vercel-build` dan driver `vercel-blob` hanya dipakai di Vercel dan boleh dibiarkan.

**Langkah:**

1. **Database:** buat Cloud SQL PostgreSQL di `asia-southeast2` (Jakarta). Aktifkan ekstensi `pg_trgm` untuk search; tanpa ekstensi ini aplikasi tetap jalan.
2. **Migrasi:** `docker build --target migrate -t …-migrate .`, lalu jalankan sebagai **Cloud Run Job** dengan `DATABASE_URL`. Jalankan setiap rilis, sebelum revisi baru menerima trafik. Data staging adalah dummy, jadi **mulai bersih** — jangan `pg_dump` dari Neon. Data customer asli hanya diimpor di Google Cloud.
3. **Storage:** buat bucket privat, set `STORAGE_DRIVER=gcs` dan `GCS_BUCKET`.
4. **Secrets:** semua variabel di `.env.example` disimpan di Secret Manager dan dipasang ke Cloud Run. `VAPID_*` pakai kunci yang sama dengan staging bila perangkat yang sudah terdaftar ingin dipertahankan. **Jangan set `SEED_ADMIN_PASSWORD` di production.**
5. **Deploy:** `docker build` → Artifact Registry → Cloud Run (`asia-southeast2`, port 8080, health check `/api/health`).
   - Service account butuh role: *Cloud SQL Client*, *Storage Object Admin* (bucket itu saja), *Vertex AI User*, *Secret Manager Secret Accessor*.
   - Pekerjaan setelah respons (`after()`: antrian skor) butuh CPU tetap jalan. Pakai **CPU always allocated** (`--no-cpu-throttling`) atau andalkan cron `qualification-queue` tiap 5 menit.
6. **Cron:** `PROJECT=… REGION=asia-southeast2 APP_URL=… CRON_SECRET=… bash deploy/cloud-scheduler.sh`.
7. **Domain & integrasi:** arahkan domain ke Cloud Run, set `APP_URL`. Di situs journey, ubah `CRM_SYNC_URL` ke domain baru (kunci tetap sama).
8. **Admin pertama** (database kosong, tanpa data demo): `ADMIN_EMAIL=… ADMIN_NAME=… ADMIN_PASSWORD='…' npm run admin:create`. Jalankan lewat Cloud SQL Auth Proxy; password minimal 12 karakter dan wajib diganti saat login pertama. Admin lalu membuat user lain di **Setting → Users & Roles** atau lewat import Employees. Login Google Workspace menyusul.

### Environment variables

Daftar lengkap dengan contoh ada di **`.env.example`**.

| Variabel | Wajib | Fungsi |
| --- | --- | --- |
| `APP_URL` | ✓ | URL publik (link email, kontak push) |
| `SESSION_SECRET` | ✓ | ≥ 32 karakter, menandatangani cookie sesi |
| `CRON_SECRET` | ✓ | Bearer untuk `/api/cron/*` |
| `DATABASE_URL` | ✓ | Koneksi aplikasi |
| `DATABASE_URL_UNPOOLED` | | Koneksi langsung untuk migrasi/seed (Neon) |
| `DATABASE_POOL_MAX` | | Koneksi per instance (default 5) |
| `STORAGE_DRIVER` | ✓ | `vercel-blob` \| `gcs` \| `local` (default `vercel-blob`) |
| `BLOB_READ_WRITE_TOKEN` | staging | Token Vercel Blob (diset otomatis oleh Vercel) |
| `GCS_BUCKET` | production | Bucket Cloud Storage privat |
| `LOCAL_UPLOAD_DIR` | dev | Folder upload lokal |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | | Email; tanpa `SMTP_HOST` email hanya di-log |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | | Push notification |
| `JOURNEY_SYNC_KEY` | | Webhook situs journey |
| `QUALIFICATION_AI`, `QUALIFICATION_AI_PROVIDER`, `QUALIFICATION_MODEL` | | Lapis AI kualifikasi |
| `GEMINI_API_KEY` | staging | Provider `gemini` |
| `VERTEX_PROJECT`, `VERTEX_LOCATION` | production | Provider `vertex` |
| `SEED_ADMIN_PASSWORD` | staging | Password akun demo; hapus setelah seed pertama |

## Belum dikerjakan (berikutnya)

- Projects berikutnya: My Work (gabungan tasks + board items), automasi; approval project_budget & purchase_request
- PDF untuk sales order / invoice (saat ini hanya quotation)
- Rate limit login, reset password, login Google Workspace
