import type { NextConfig } from "next";

// Packages that must never be bundled into client or edge chunks.
// Webpack/Turbopack both honor serverExternalPackages — without this,
// CJS packages like razorpay fail at runtime when Next.js 16 bundles them.
const serverOnlyPackages = ["mongoose", "razorpay", "aws-sdk"];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Avoids build failures on small EC2 instances
  typescript: {
    ignoreBuildErrors: true,
  },

  // Allow LAN access during development (matches boilerplate pattern)
  allowedDevOrigins: [
    "192.168.1.17",
    "192.168.1.13",
    "192.168.1.21",
    "192.168.1.19",
  ],

  serverExternalPackages: serverOnlyPackages,

  images: {
    formats: ["image/webp", "image/avif"],
  },
};

export default nextConfig;
