import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb", // POS material-receipt export reports run a few MB
    },
  },
};

export default nextConfig;
