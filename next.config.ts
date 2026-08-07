import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    // Every upload here is a Server Action (booking attachment, outsource quote,
    // signature), so Next's 1MB default body limit governs them — not the app's
    // own 10MB check and not nginx's `client_max_body_size 12m`. Both of those
    // were dead letters: anything over ~1MB failed in the framework before
    // either could run, while the Thai copy promised 10MB.
    // Sized to nginx so the outermost and innermost limits agree, leaving the
    // app's 10MB check as the one that actually reports the error to the user.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default withNextIntl(nextConfig);
