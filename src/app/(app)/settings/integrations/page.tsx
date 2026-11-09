import type { Metadata } from "next";
import { connection } from "next/server";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import type { Tone } from "@/lib/labels";

export const metadata: Metadata = { title: "Integrations" };
const HREF = "/settings/integrations";

export default async function IntegrationsPage() {
  const { denied } = await guard(HREF);
  if (denied) return denied;
  await connection();
  const smtp = Boolean(process.env.SMTP_HOST);

  const items: { name: string; purpose: string; status: string; tone: Tone }[] = [
    { name: "In-app notifications", purpose: "Bell + notification list for updates, approvals and deadlines.", status: "Active", tone: "ok" },
    {
      name: "Email (SMTP)",
      purpose: "Approval requests, deadline reminders and a daily digest.",
      status: smtp ? "Connected" : "Log only — SMTP not set",
      tone: smtp ? "ok" : "warn",
    },
    { name: "Journey site (aroma quiz)", purpose: "Quiz registrations flow in as leads via webhook, with retry.", status: "Planned", tone: "info" },
    { name: "Google Workspace", purpose: "Sign in with company Google accounts; Chat and Calendar reminders.", status: "Waiting for client", tone: "info" },
    { name: "Gemini (Vertex AI)", purpose: "AI lead qualification from visit notes, with a written reason.", status: "Planned", tone: "info" },
    { name: "Website & marketplaces", purpose: "Online orders into purchase history.", status: "Next stage", tone: "neutral" },
    { name: "WhatsApp", purpose: "Notifications by WhatsApp.", status: "Not used — paid per message", tone: "neutral" },
  ];

  return (
    <>
      <PageHeader href={HREF} />
      <Panel flush>
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{i.name}</p>
                <p className="text-[13px] text-muted">{i.purpose}</p>
              </div>
              <Pill tone={i.tone}>{i.status}</Pill>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
