import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_API_BASE: process.env.API_BASE ?? "http://localhost:4000/api/v1" },
};

export default config;
