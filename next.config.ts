import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@openai/codex-sdk", "@openai/codex"],
};

export default nextConfig;
