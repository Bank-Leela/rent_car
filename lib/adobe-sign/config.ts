// Adobe Acrobat Sign credentials, read from the environment. The integration is
// inert until all four are set — isAdobeSignConfigured() gates every action,
// route, and UI affordance, so the feature ships dormant with no API access.

export type AdobeSignConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  shard: string; // data-center shard for the token endpoint, e.g. "na1", "eu2"
};

export function getAdobeSignConfig(): AdobeSignConfig | null {
  const clientId = process.env.ADOBE_SIGN_CLIENT_ID;
  const clientSecret = process.env.ADOBE_SIGN_CLIENT_SECRET;
  const refreshToken = process.env.ADOBE_SIGN_REFRESH_TOKEN;
  const shard = process.env.ADOBE_SIGN_SHARD;
  if (!clientId || !clientSecret || !refreshToken || !shard) return null;
  return { clientId, clientSecret, refreshToken, shard };
}

export function isAdobeSignConfigured(): boolean {
  return getAdobeSignConfig() !== null;
}
