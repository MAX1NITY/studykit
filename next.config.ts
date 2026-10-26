import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page in StudyKit is per-user and request-time (auth cookies + the
  // signed-in user's own rows), so there is no static shell worth
  // prerendering. Cache Components is deliberately left off: it would turn
  // each session read into a required Suspense boundary for no gain here.
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
