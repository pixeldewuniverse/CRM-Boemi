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
    (app)/            halaman yang butuh login: dashboard, customers, notifications
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

## Skema Phase 1

`users` (role: admin, executive, sales_manager, sales, marketing, finance) · `customers` (sumber/UTM, consent marketing, minat produk, **skor & tier kualifikasi + alasan**) · `contacts` · `qualification_criteria` (kriteria dari client + bobot) · `visits` (GPS + foto) · `visit_fees` (approval finance) · `tasks` (follow-up + deadline) · `products` · `opportunities` (pipeline) · `orders` / `order_items` (riwayat pembelian) · `campaigns` · `kpi_targets` · `notifications` / `notification_preferences` · `audit_logs`.

Uang disimpan sebagai Rupiah bulat (`bigint`).

## Notifikasi

Saat ini: **in-app + email**. Setiap user bisa mengatur per jenis notifikasi (`notification_preferences`). Jenis yang sudah ada: tugas di-assign, tugas jatuh tempo ≤ 24 jam, tugas terlambat, visit fee menunggu/diputuskan, perubahan stage pipeline, lead Hot baru.

Google Chat & Google Calendar bisa ditambahkan sebagai channel setelah Google Workspace BOEMI dikonfirmasi — cukup ubah `src/lib/notifications/index.ts`.

## Cron

| Job | Jadwal (UTC) | Fungsi |
| --- | --- | --- |
| `/api/cron/task-reminders` | 00:00 (07:00 WIB) | Pengingat tugas ≤ 24 jam & terlambat (tidak dobel dalam 20 jam) |
| `/api/cron/pending-visit-fees` | 01:00 (08:00 WIB) | Ingatkan approver soal visit fee > 24 jam |

Semua job butuh header `Authorization: Bearer $CRON_SECRET`. Vercel Cron mengirim header ini otomatis bila `CRON_SECRET` diset.

## Pindah ke Google Cloud BOEMI

1. **Database:** buat Cloud SQL PostgreSQL (region `asia-southeast2` Jakarta), lalu `pg_dump` dari Neon → `pg_restore` ke Cloud SQL (atau mulai bersih dengan `npm run db:migrate`).
2. **Storage:** buat bucket Cloud Storage (private), set `STORAGE_DRIVER=gcs` dan `GCS_BUCKET`. Salin file dari Blob bila perlu.
3. **Deploy:** `docker build` → Artifact Registry → Cloud Run. Pasang service account dengan akses Cloud SQL + bucket. Simpan secret di Secret Manager.
4. **Cron:** buat 2 job Cloud Scheduler (lihat tabel di atas) dengan header Authorization yang sama.
5. **Domain:** arahkan domain ke Cloud Run, set `APP_URL`.

## Belum dikerjakan (berikutnya)

- Halaman CRUD: detail customer, visit (GPS + foto), approval visit fee, tugas, pipeline, order, produk, KPI, campaign
- Bulk import/export CSV
- Scoring kualifikasi (rule-based dari `qualification_criteria` + Gemini/Vertex AI untuk catatan kunjungan)
- Integrasi form journey (`journey.boemibotanicals.com`) via webhook + outbox
- Rate limit login, reset password, login Google Workspace
