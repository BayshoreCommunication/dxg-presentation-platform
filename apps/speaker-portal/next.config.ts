import type { NextConfig } from "next";

const config: NextConfig = {
  // @pmp/format ships TypeScript, not built JS, so Next has to compile it.
  transpilePackages: ["@pmp/format"],
  reactStrictMode: true,
  // The theme switch lives in the bottom-left corner (D-084); keep the dev-only Next.js
  // badge out of its way.
  devIndicators: { position: "bottom-right" },
  env: { NEXT_PUBLIC_API_BASE: process.env.API_BASE ?? "http://localhost:4000/api/v1" },
};

export default config;
