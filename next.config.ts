import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // There are stray lockfiles above this directory, and without this Turbopack
  // infers the home directory as the workspace root.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
