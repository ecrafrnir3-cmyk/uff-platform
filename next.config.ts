import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Source map upload — only runs if these env vars are set in Vercel
  org: process.env.SENTRY_ORG ?? "",
  project: process.env.SENTRY_PROJECT ?? "",
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Suppress verbose build output
  silent: true,

  // Upload larger set of source files for better stack traces
  widenClientFileUpload: true,

  // Hide source maps from client bundle
  hideSourceMaps: true,

  // Automatically monitor Vercel cron jobs via Sentry check-ins
  automaticVercelMonitors: true,
});
