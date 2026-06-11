import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ultimate Fantasy Football",
    short_name: "UFF",
    description: "The Oracle's Calls — your fantasy football command center.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0d1a",
    theme_color: "#0057FF",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
