import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page in StudyKit is per-user and request-time (auth cookies + the
  // signed-in user's own rows), so there is no static shell worth
  // prerendering. Cache Components is deliberately left off: it would turn
  // each session read into a required Suspense boundary for no gain here.
  // The Core 1 syllabus text is read from disk at request time by
  // /api/prep/seed rather than imported, so file tracing has to be told
  // about it. It is gitignored, so a deployment usually will not have it and
  // /prep offers the file drop instead; this is here for a local run.
  outputFileTracingIncludes: {
    "/api/prep/seed": ["./content/core1/**"],
  },
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
