import type { NextConfig } from "next";

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const cspFrameAncestors =
  allowedOrigins.length > 0
    ? `frame-ancestors 'self' ${allowedOrigins.join(" ")}`
    : "frame-ancestors 'self'";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/slides": ["./docs/references/strategy-prompts/*.txt"],
    "/api/slides/check": ["./docs/references/strategy-prompts/*.txt"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: cspFrameAncestors,
          },
          {
            key: "X-Frame-Options",
            value: allowedOrigins.length > 0 ? "ALLOWALL" : "SAMEORIGIN",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
