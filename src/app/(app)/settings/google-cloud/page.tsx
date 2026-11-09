import type { Metadata } from "next";
import { connection } from "next/server";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";

export const metadata: Metadata = { title: "Google Cloud" };
const HREF = "/settings/google-cloud";

export default async function GoogleCloudPage() {
  const { denied } = await guard(HREF);
  if (denied) return denied;
  await connection();
  let dbHost = "not set";
  try {
    dbHost = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {}
  const onNeon = dbHost.endsWith("neon.tech");
  const gcs = process.env.STORAGE_DRIVER === "gcs";

  const rows = [
    { part: "Application", now: "Vercel (staging)", target: "Cloud Run · asia-southeast2 (Jakarta)" },
    { part: "Database", now: onNeon ? "Neon Postgres (staging)" : "PostgreSQL", target: "Cloud SQL for PostgreSQL" },
    { part: "Photos & files", now: gcs ? "Cloud Storage" : "Vercel Blob, private (staging)", target: "Cloud Storage, private bucket" },
    { part: "Scheduled jobs", now: "Vercel Cron", target: "Cloud Scheduler" },
    { part: "Secrets", now: "Vercel environment variables", target: "Secret Manager" },
    { part: "Sign-in", now: "Email + password", target: "Google Workspace accounts" },
    { part: "AI qualification", now: "—", target: "Vertex AI (Gemini)" },
  ];

  return (
    <>
      <PageHeader href={HREF} />
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
        <Pill tone="warn">Staging</Pill>
        This environment runs on Vercel with dummy data. Real customer data is only loaded after the move to your Google Cloud project.
      </div>
      <Panel title="Where each part runs" flush>
        <table className="tbl min-w-[680px]">
          <thead>
            <tr>
              <th>Part</th>
              <th>Now</th>
              <th>After go-live</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.part}>
                <td className="font-semibold">{r.part}</td>
                <td className="text-muted">{r.now}</td>
                <td>{r.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Move checklist">
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px]">
          <li>Grant access to the Google Cloud project (Editor on a dedicated project, billing stays with you).</li>
          <li>Create Cloud SQL, a private Cloud Storage bucket and secrets in Secret Manager.</li>
          <li>Deploy the container to Cloud Run with a service account; run database migrations.</li>
          <li>Create the two Cloud Scheduler jobs (task reminders 07:00, fee reminders 08:00 WIB).</li>
          <li>Point the domain to Cloud Run, switch sign-in to Google Workspace, import real data.</li>
        </ol>
      </Panel>
    </>
  );
}
