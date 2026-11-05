import type { Metadata } from "next";
import { ModulePage } from "@/components/page/module-page";
import { NAV, findNav } from "@/lib/nav";

export function generateStaticParams() {
  return NAV.flatMap((c) => c.items)
    .map((i) => i.href.split("/").filter(Boolean))
    .filter((parts) => parts.length === 2 && !["dashboard", "database"].includes(parts[0]))
    .map(([section, page]) => ({ section, page }));
}

export async function generateMetadata({ params }: PageProps<"/[section]/[page]">): Promise<Metadata> {
  const { section, page } = await params;
  return { title: findNav(`/${section}/${page}`)?.item.label ?? "Not found" };
}

export default async function Page({ params }: PageProps<"/[section]/[page]">) {
  const { section, page } = await params;
  return <ModulePage pathname={`/${section}/${page}`} />;
}
