import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/room/PREM25",
        destination: "/room/KHUSHALSMELLS",
        permanent: true,
      },
      {
        source: "/room/PREM25/:path*",
        destination: "/room/KHUSHALSMELLS/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
