import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default withSentryConfig(nextConfig, {
  // SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT are optional at build time —
  // when absent (local dev, forked PRs) the plugin skips source map upload
  // and release creation rather than failing the build. See
  // docs/infra/provisioning.md for where these are configured in CI/Vercel.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: false,
  },
});
