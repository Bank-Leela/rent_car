import crypto from "node:crypto";

// The daily-batch cron route is gated on CRON_SECRET. Unset → the route fails
// closed (503), so automation is inert until the secret is configured.
export function getCronSecret(): string | null {
  return process.env.CRON_SECRET || null;
}

// Timing-safe bearer check against CRON_SECRET.
export function isValidCronAuth(authHeader: string | null): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  const presented = (authHeader ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
