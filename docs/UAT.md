# UAT Fase 1 — skenario per role

Untuk staging (data dummy). Login dengan password demo (`SEED_ADMIN_PASSWORD` saat seed pertama). Isi kolom **Hasil** dengan ✅ / ❌ + catatan; setiap ❌ dicatat sebagai temuan dengan langkah ulang dan screenshot.

| Role | Akun | Nama | Departemen |
| --- | --- | --- | --- |
| Super Admin | `admin@example.test` | System Admin | IT |
| Executive / Director | `owner@example.test` | BOEMI Owner | Management |
| Department Head / Manager | `manager@example.test` | Ayu Pratiwi | Sales (kepala) |
| Finance / Approver | `finance@example.test` | Rina Kartika | Finance |
| Project Manager | `pm@example.test` | Rizky Pratama | Management |
| Sales User | `sales@example.test` | Komang Sari | Sales |
| Sales User (pembanding scope) | `dewi@example.test`, `putu@example.test` | Dewi Lestari, Putu Ratna | Sales |
| Marketing User | `marketing@example.test` | Ni Luh Wulan | Marketing (kepala) |
| Designer | `designer@example.test` | Sri Wahyuni | Content Design |
| General Staff | `staff@example.test` | Made Wirawan | Sales |

Umum untuk semua skenario:
- Uji di laptop (Chrome) **dan** HP lebar ±375 px. Di HP, tidak boleh ada scroll ke samping kecuali di dalam tabel/board.
- Setiap perubahan data harus muncul di **Setting → Audit Trail** (dicek Super Admin di akhir, skenario ADM-10).

---

## Sales User — Komang (`sales@`)

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| SLS-01 | Login. Buka **Dashboard → Overview**. | Sapaan "Hello, Komang". Kartu Revenue, Open pipeline, Forecast, New leads, Needs attention. Kartu **Contact today**. Tidak ada kartu Projects / Waiting for approval. | |
| SLS-02 | Buka **Sales → Contact Today**, tab *All open leads*. | Hanya lead milik Komang. Urutan dari *priority* tertinggi. Setiap baris punya skor, tier, status SLA, tombol telepon/WhatsApp/Contacted. | |
| SLS-03 | Klik **Contacted** pada lead teratas di tab *Due now*. | Lead hilang dari *Due now*, muncul lagi di *All* dengan "Last contact · waiting 0 days". | |
| SLS-04 | **Sales → Leads → + Lead**: isi nama, HP baru, kota Seminyak, segmen Hotel & Spa, sumber Website, catatan "Butuh refill amenities untuk 18 kamar, minta harga dan sampel". Simpan. | Simpan cepat (tidak menunggu skor). Dalam beberapa detik setelah refresh, lead punya skor + tier. | |
| SLS-05 | Klik skor lead tadi. | Dialog rincian: tiap kriteria (rule/AI) beserta poinnya. Bila AI aktif, kutipan dari catatan, "Ask next", saran langkah, versi kriteria. Teks menyebut nama/HP/email tidak dikirim. | |
| SLS-06 | Di dialog: pilih tier *Hot* tanpa alasan → **Save override**. Lalu isi alasan ≥ 10 karakter → simpan. | Tanpa alasan: ditolak "at least 10 characters" dan pilihan tidak hilang. Dengan alasan: tier Hot + tanda ✎ di daftar. | |
| SLS-07 | Coba tambah lead dengan HP yang sudah ada. | Ditolak sebagai duplikat. | |
| SLS-08 | **Qualify** lead → isi deal "First order", nilai, tanggal close. | Akun baru + kontak + deal. Notifikasi ke manager. Akun ikut diberi skor. | |
| SLS-09 | **Sales → Pipeline**: drag deal ke *Quotation Sent*; drag deal lain ke *Lost* (pilih alasan). | Stage tersimpan. Lost wajib alasan. Lajur menampilkan total dan % probability dari Master Data. | |
| SLS-10 | **Sales → Sales Forecast**. Isi probability 90 pada satu deal → **Set**; kosongkan → **Set**. | Tabel per bulan (Target, Actual, Commit, Weighted, Best case, Projected). Tidak ada tabel "By rep". Deal: 90% lalu kembali ke default stage. | |
| SLS-11 | Buat quotation dari akun milik sendiri dengan diskon 15%. | Tier harga otomatis dari segmen. Diskon > 10% → *Waiting approval*; tidak bisa dikirim sebelum disetujui. PDF bertanda DRAFT. | |
| SLS-12 | **Sales → Visits → + Check-in** dengan foto + GPS + visit fee Rp 75.000. | Visit tersimpan, fee *pending* menunggu Manager/Finance. Skor akun diperbarui. | |
| SLS-13 | Detail akun milik sendiri → **Log activity** (WhatsApp). | Muncul di timeline. Panel *Qualification* bisa **Re-score**. | |
| SLS-14 | Ketik di address bar URL akun milik Dewi (ambil dari Dewi, misalnya `/database/accounts/<id>`). | Halaman *not found* — data akun tidak tampil. | |
| SLS-15 | Buka `/report/sales`, `/report/projects`, `/settings/users`. | Server menampilkan "Your role doesn't have access to this page". | |
| SLS-16 | **Projects** → buka project *Alas Harum — Amenities Rollout Q1*. Ubah status satu item, isi Budget, tambah subitem. | Bisa (editor). Tidak ada menu kolom (bukan owner). Bulk **Delete…** tidak tersedia. | |
| SLS-17 | Search (Ctrl+K) "Dewi" / nama akun milik Dewi. | Tidak ada data milik rep lain. | |
| SLS-18 | Export CSV di Accounts. | Hanya akun milik Komang. | |

## Sales User — Dewi (`dewi@`) — cek scope silang

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| DSL-01 | Lihat Leads, Pipeline, Orders, Contact Today. | Hanya data milik Dewi. Lead Komang dari SLS-04 tidak terlihat. | |
| DSL-02 | Buka URL quotation/order milik Komang. | *Not found*. | |

## Department Head / Manager — Ayu (`manager@`)

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| MGR-01 | Dashboard → Overview, lalu **Team & Sales KPI**. | Data seluruh tim Sales (Komang, Dewi, Putu); tabel target per rep. | |
| MGR-02 | **Approvals**: setujui visit fee dari SLS-12; tolak satu tanpa alasan, lalu dengan alasan. | Approve berhasil, item hilang dari inbox, pemohon dapat notifikasi. Reject tanpa alasan ditolak. | |
| MGR-03 | Setujui diskon quotation SLS-11. | Status *Discount approved*; Komang bisa mengirim quotation. | |
| MGR-04 | **Sales → Targets**: isi target revenue bulan depan; **Copy last month**. | Tersimpan; actual vs target terlihat. | |
| MGR-05 | **Sales → Sales Forecast**, filter per rep, 3/6/12 bulan; **Export CSV**. | Tabel *By rep* untuk tim. CSV sesuai filter. | |
| MGR-06 | **Report → Sales / Funnel / Projects / Department KPI** (ganti periode ke *This quarter*). | Semua terbuka. Department KPI hanya baris **Sales** (departemen yang dipimpin), tanpa "Cost per lead". | |
| MGR-07 | Assign lead tanpa owner ke Putu. | Putu dapat notifikasi; lead pindah ke Contact Today Putu. | |
| MGR-08 | **Projects** → project Alas Harum: menu kolom tersedia (departemen Sales dipimpin Ayu). Rename grup, tambah kolom *Text*. | Bisa (Department Head mengelola board departemennya). | |
| MGR-09 | Buka `/settings/users` dan `/settings/master-data`. | Ditolak di server (Super Admin only). `/settings/templates` terbuka. | |
| MGR-10 | Override tier lead milik Komang dengan alasan. | Berhasil; tercatat di audit. | |

## Finance / Approver — Rina (`finance@`)

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| FIN-01 | **Approvals**: setujui visit fee yang menunggu *Manager or Finance*. | Berhasil; fee *approved*. | |
| FIN-02 | Detail order → **+ Payment** (deposit). | Status bayar berubah (unpaid → deposit / paid). | |
| FIN-03 | **Report → Receivables & Deposits**. | Terbuka. | |
| FIN-04 | `/report/sales`, `/report/projects`, `/sales/contact-today`. | Ditolak di server. | |
| FIN-05 | **Projects**. | Tidak ada board yang tampil (bukan anggota, departemen lain). URL project Alas Harum → *not found*. | |

## Executive / Director — Owner (`owner@`)

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| EXE-01 | Dashboard → Overview. | Ada kartu **Projects** (open, late, avg progress, overdue + daftar berisiko) dan **Waiting for approval · N** (semua permintaan pending, paling lama di atas). | |
| EXE-02 | **Approvals**: setujui project ≥ Rp 50 jt yang diajukan PM (lihat PM-05). | Project berubah *Active*. | |
| EXE-03 | **Report → Projects**: cari *Website Relaunch & Online Catalogue*. | Ditandai **Late**, spent melebihi budget (merah). *Sanur Spa pilot* 100% on-time. | |
| EXE-04 | **Report → Department KPI** → *This year* → **Export CSV**. | Semua departemen; panel Marketing dengan Cost per lead. | |
| EXE-05 | **Projects**: buka board *private* (minta PM men-set satu board ke Private). | Executive tetap bisa melihat. | |
| EXE-06 | `/settings/users`. | Ditolak (Super Admin only). | |

## Project Manager — Rizky (`pm@`)

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| PM-01 | **Projects → Boards & Projects**. | Project PRJ-…-001 di workspace Sales; tombol **+ Project** / **+ Team board**. | |
| PM-02 | Buka Alas Harum → Main Table: edit sel (status, timeline, angka Rp, dropdown, link, upload file PDF), drag baris antar grup, multi-select → Move to *Delivery*. | Semua tersimpan; ringkasan grup ikut berubah; bulk tercatat di audit. | |
| PM-03 | Tab **Kanban**: drag kartu ke *Done*. **Timeline**: geser bar 2 hari, tarik tepi bar, keyboard ←/→. **Calendar**: drag item ke hari lain. | Status/tanggal tersimpan dan sama di semua tab. | |
| PM-04 | **Edit details** → Dependencies *Strict*. Di Timeline, geser item ke sebelum pendahulunya. | Ditolak "Not saved — this board uses strict dependencies…", bar kembali ke posisi semula. | |
| PM-05 | **+ Project** budget Rp 60.000.000 → **Submit for approval**. | Kode PRJ berikutnya, status *Draft* → *Waiting approval* (Executive menyetujui di EXE-02). Budget < 50 jt → langsung *Active*. | |
| PM-06 | Tab **Workload** (kapasitas 20 jam), **Dashboard**. | Sel merah/oranye saat beban > kapasitas; klik sel menampilkan item. Dashboard menampilkan progress, overdue, budget. | |
| PM-07 | **Members**: tambah Made sebagai Viewer; Sri sebagai Editor *own items only*. | Tersimpan; tercatat di audit. | |
| PM-08 | Item dependency: tambah dependency yang membuat loop. | Ditolak "That would create a loop…". | |

## Designer — Sri (`designer@`)

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| DSG-01 | Project Alas Harum: ubah status *Label & packaging design* (di-assign ke Sri). | Bisa. | |
| DSG-02 | Coba ubah *Kick-off with the Alas Harum GM* (bukan miliknya), drag kartunya di Kanban, geser barnya di Timeline. | Sel terkunci, kartu & bar tidak bisa dipindah. Bila dipaksa lewat server: "You can only edit items assigned to you." | |
| DSG-03 | Board **Content Requests**: tambah item baru. | Item otomatis di-assign ke Sri. | |
| DSG-04 | **Marketing → Content Calendar**: upload hasil desain pada konten yang menunggu desainer. | Status maju ke review; content writer dapat notifikasi. | |
| DSG-05 | `/report/sales`, `/settings/audit`. | Ditolak. | |

## Marketing User — Wulan (`marketing@`)

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| MKT-01 | **Marketing → Campaigns**: buat campaign dengan budget & periode; **Event → Event List**: buat event. | Tersimpan; muncul di Calendar. | |
| MKT-02 | **Marketing → Lead Sources & Attribution**. | Lead per sumber + rasio qualified. | |
| MKT-03 | Kirim tamu dari situs journey (atau `POST /api/leads/journey` dengan kunci). | Lead *Aroma journey* baru, tanpa owner, langsung diberi skor di background. Marketing dapat ≤ 1 notifikasi gabungan per 6 jam. | |
| MKT-04 | **Contact Today**. | Terbuka; lead tanpa owner tetap ada di urutan. | |
| MKT-05 | Board **Content Requests** (owner): tambah kolom, edit label status. | Bisa; status wajib punya ≥ 1 label kategori *Done*. | |
| MKT-06 | `/report/marketing`. | Ditolak (Reporting: Executive & Department Head). | |

## General Staff — Made (`staff@`)

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| STF-01 | Dashboard, Contact Today, Leads, Tasks. | Hanya data miliknya (scope *own*). | |
| STF-02 | **Projects** → Alas Harum (departemen Sales). | Bisa melihat, tidak ada **New item**, semua sel terkunci. | |
| STF-03 | `/report/sales`, `/settings/users`, `/sales/forecast` (lihat datanya sendiri). | Report & Setting ditolak; Forecast hanya datanya sendiri. | |

## Super Admin (`admin@`)

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| ADM-01 | **Setting → Users & Roles**: tambah user Sales baru. | Password sementara tampil sekali (+ email bila SMTP aktif); login pertama wajib ganti password. | |
| ADM-02 | Ubah role user tadi / nonaktifkan. | Sesi user langsung putus. Tidak bisa menonaktifkan diri sendiri atau Super Admin aktif terakhir. | |
| ADM-03 | **Departments & Teams**: buat sub-departemen di Sales dengan kepala. | Kepala melihat data departemen + sub-departemen. | |
| ADM-04 | **Approval Workflows**: buat flow visit fee ≥ Rp 1 jt → atasan langsung → Finance; **Test** dengan pemohon Komang. | Simulasi menyebut approver per step. | |
| ADM-05 | **Master Data**: tambah kriteria rule (*Lead source equals Website*, bobot 5), edit → nonaktifkan; ubah probability *Negotiation* ke 70; coba warm ≥ hot. | Tersimpan; pipeline memakai 70%; ambang yang tidak valid ditolak. | |
| ADM-06 | Master Data → **Re-score all**. | Antrian terisi; skor berubah dalam beberapa menit; tercatat di audit. | |
| ADM-07 | **Document Templates**: ubah prefix quotation. | Quotation berikutnya memakai nomor baru. | |
| ADM-08 | **Google Cloud**: cek status. | Staging: Vercel/Neon/Blob + status AI. Production: Cloud Run. | |
| ADM-09 | **Import / Export**: import Leads (template), mode *Skip*; import Employees. | Ringkasan hasil + error report; lead hasil import diberi skor. | |
| ADM-10 | **Audit Trail**. | Ada entri untuk create/update/delete/approve/export/import/override dari semua skenario di atas. | |

## Sistem (dicek oleh admin teknis)

| ID | Langkah | Hasil yang diharapkan | Hasil |
| --- | --- | --- | --- |
| SYS-01 | `GET /api/cron/lead-sla` tanpa header, lalu dengan `Authorization: Bearer <CRON_SECRET>`. | 401, lalu `{ ok: true, reminded: N }`. Panggilan kedua: `reminded: 0`. | |
| SYS-02 | Matikan AI (`QUALIFICATION_AI` kosong) atau pakai API key salah, lalu buat lead. | Lead tetap diberi skor dari rules; dialog skor menulis "AI unavailable… it will retry". | |
| SYS-03 | `GET /api/health`. | `{ "status": "ok" }`. | |
| SYS-04 | Buka `/ecommerce/orders`, `/store/overview`, `/consignment/outlets`. | Dialihkan ke Dashboard (Phase 2+ disembunyikan). | |
| SYS-05 | Logout, buka `/dashboard`. | Dialihkan ke `/login`. | |

---

**Tanda tangan UAT**

| Role | Nama penguji | Tanggal | Lulus / catatan |
| --- | --- | --- | --- |
| Super Admin | | | |
| Executive | | | |
| Department Head | | | |
| Finance | | | |
| Project Manager | | | |
| Sales | | | |
| Marketing | | | |
| Designer | | | |
| General Staff | | | |
