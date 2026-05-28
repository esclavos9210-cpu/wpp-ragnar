import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@whiskeysockets/baileys",
    "better-sqlite3",
    "pino",
  ],
};

export default nextConfig;
