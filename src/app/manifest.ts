import type { MetadataRoute } from "next";

/** Makes the app installable (required for push on iPhone: Add to Home Screen). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BOEMI Sales & Marketing Tools",
    short_name: "BOEMI Tools",
    description: "Sales & Marketing Tools for BOEMI",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f6f3ec",
    theme_color: "#616b37",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
