import type { NextConfig } from "next";

// Cache Components is left off: almost every page here depends on the
// connected wallet or live chain state, so request-time rendering is the
// simpler and safer default. See docs/ARCHITECTURE.md.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
