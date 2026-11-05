import type { Metadata } from "next";
import { ModulePage } from "@/components/page/module-page";
import { findNav, pagesUnder } from "@/lib/nav";

export function generateStaticParams() {
  return pagesUnder("dashboard");
}

export async function generateMetadata({ params }: PageProps<"/dashboard/[page]">): Promise<Metadata> {
  const { page } = await params;
  return { title: findNav(`/dashboard/${page}`)?.item.label ?? "Not found" };
}

export default async function Page({ params }: PageProps<"/dashboard/[page]">) {
  const { page } = await params;
  return <ModulePage pathname={`/dashboard/${page}`} />;
}
