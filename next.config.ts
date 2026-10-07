import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // There are stray lockfiles above this directory, and without this Turbopack
  // infers the home directory as the workspace root.
  turbopack: { root: import.meta.dirname },
  // The verification email links its images from /email-assets/, and Gmail
  // fetches them through its image proxy. The default here is `max-age=0,
  // must-revalidate`, which has the proxy ask again on every open; a week lets
  // it serve its own copy. A changed image needs a new file name (or a `?v=` on
  // its URL in otp-email.ts), or the old one is served until the week runs out.
  async headers() {
    return [
      {
        source: "/email-assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
