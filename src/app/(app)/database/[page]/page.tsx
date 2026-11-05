import type { Metadata } from "next";
import { ModulePage } from "@/components/page/module-page";
import { findNav, pagesUnder } from "@/lib/nav";

export function generateStaticParams() {
  return pagesUnder("database").filter((p) => p.page !== "accounts");
}

export async function generateMetadata({ params }: PageProps<"/database/[page]">): Promise<Metadata> {
  const { page } = await params;
  return { title: findNav(`/database/${page}`)?.item.label ?? "Not found" };
}

export default async function Page({ params }: PageProps<"/database/[page]">) {
  const { page } = await params;
  return <ModulePage pathname={`/database/${page}`} />;
}
