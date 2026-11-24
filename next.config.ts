import type { NextConfig } from "next";

// Google sign-in reuses the ARS Power BI website's Firebase project (D-038).
// These four values identify the project; they are not secrets (Firebase
// ships them to every browser by design). They are hard-coded as a fallback
// because GoDaddy's Node.js hosting only injects env vars at runtime, not at
// build time, and NEXT_PUBLIC_* values must exist at build time to be
// inlined (lesson from D:\PBI New next.config.ts, 2026-09-10).
const FIREBASE_PUBLIC_CONFIG = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyC-tY0ZmZULxhW4Wvm4WwNL4tlkj3J2lLI",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "power-bi-dashboard-3b29f.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "power-bi-dashboard-3b29f",
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:408485424707:web:e184fffb7a4e066c9e2ef6",
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // D-016: reveal nothing about the stack or the build.
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  env: FIREBASE_PUBLIC_CONFIG,
  // Attachments (D-072; D-330: 10 files): up to 10 files of 10 MB in one
  // upload. The middleware limit must match, or big bodies would be cut short.
  experimental: {
    serverActions: { bodySizeLimit: "102mb" },
    middlewareClientMaxBodySize: "102mb",
  },
  // v1.89.0 (D-424): the Dashboards hub opens Utilisation. A server redirect
  // (307, query kept) instead of the page's redirect(), which ran after the
  // segment's loading boundary had streamed and so reached the browser as a
  // <meta http-equiv="refresh"> (axe meta-refresh in WebKit). The page's own
  // redirect stays as the fallback; Utilisation checks the area itself.
  async redirects() {
    return [{ source: "/admin/insights/dashboards", destination: "/admin/insights/dashboards/utilisation", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Firebase signInWithPopup needs window.opener to survive; GoDaddy's
          // default COOP header breaks it (Power BI site lesson).
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      // D-251: the service worker is always checked for a new version.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
