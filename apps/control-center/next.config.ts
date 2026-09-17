import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  env: { API_BASE: process.env.API_BASE ?? "http://localhost:4000/api/v1" },
};

export default config;
