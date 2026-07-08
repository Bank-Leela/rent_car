// Google Maps driving-distance lookup — gated behind GOOGLE_MAPS_API_KEY so it
// stays inert (and free) until a key is added. Origin is the faculty; the
// destination is the booking's destination + province. Diagram:
// "ก่อน Approve เอาระยะทางจาก Googlemap อัตโนมัติ".

const FACULTY_ORIGIN = "คณะแพทยศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย";

export function getMapsApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

export function isMapsConfigured(): boolean {
  return getMapsApiKey() !== null;
}

// The faculty origin can be overridden per deployment (e.g. a precise address).
function origin(): string {
  return process.env.FACULTY_ORIGIN || FACULTY_ORIGIN;
}

// Pure: build the Distance Matrix request URL. Kept separate so it's unit-tested
// without a network call or a real key.
export function buildDistanceUrl(opts: { destination: string; province: string; key: string }): string {
  const dest = [opts.destination, opts.province, "ประเทศไทย"].filter(Boolean).join(", ");
  const params = new URLSearchParams({
    origins: origin(),
    destinations: dest,
    mode: "driving",
    units: "metric",
    key: opts.key,
  });
  return `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
}

// Pure: pull the one-way distance (km, rounded) out of a Distance Matrix
// response, or null if the API couldn't route it.
export function parseDistanceKm(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.status !== "OK") return null;
  const rows = b.rows as Array<{ elements?: Array<{ status?: string; distance?: { value?: number } }> }> | undefined;
  const el = rows?.[0]?.elements?.[0];
  if (!el || el.status !== "OK" || typeof el.distance?.value !== "number") return null;
  return Math.round(el.distance.value / 1000);
}

// Look up the driving distance for a booking's destination. Throws if the key
// is missing (callers gate on isMapsConfigured) or the request fails; returns
// null when the API can't route the address.
export async function getDrivingDistanceKm(destination: string, province: string): Promise<number | null> {
  const key = getMapsApiKey();
  if (!key) throw new Error("Google Maps is not configured");
  const res = await fetch(buildDistanceUrl({ destination, province, key }));
  if (!res.ok) throw new Error(`Distance Matrix failed: ${res.status}`);
  return parseDistanceKm(await res.json());
}
