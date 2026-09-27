import type { NextConfig } from "next";

const config: NextConfig = {
  // @pmp/format ships TypeScript, not built JS, so Next has to compile it.
  transpilePackages: ["@pmp/format"],
  reactStrictMode: true,
  // No "X-Powered-By: Next.js" — it tells a visitor nothing they need.
  poweredByHeader: false,
  // The browser calls `/api` on this site; in development Next passes it to the API
  // (in production the web server does, and this rewrite is not reached).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_INTERNAL_ORIGIN ?? "http://localhost:4000"}/api/:path*` }];
  },
  // Large uploads go through the rewrite in development; the default 30 s cut them off.
  experimental: { proxyTimeout: 10 * 60 * 1000 },
  // A self-contained server for the production image.
  output: "standalone",
};

export default config;
