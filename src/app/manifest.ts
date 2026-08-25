import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ultimate Fantasy Football",
    short_name: "UFF",
    description: "The Oracle's Calls — your fantasy football command center.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d0d1a",
    theme_color: "#0057FF",
    categories: ["sports", "games"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
