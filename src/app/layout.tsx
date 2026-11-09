import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sales & Marketing Tools", template: "%s · BOEMI" },
  description: "BOEMI Sales & Marketing Tools",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "BOEMI Tools", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1218" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
