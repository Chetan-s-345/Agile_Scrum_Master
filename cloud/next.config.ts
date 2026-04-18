import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "tailark.com",
      },
      {
        protocol: "https",
        hostname: "html.tailus.io",
      },
    ],
  },
};

export default nextConfig;
