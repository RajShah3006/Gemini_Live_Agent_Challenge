import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    // Prevent Next from inferring a parent directory as workspace root
    root: __dirname,
  },
};

export default nextConfig;

