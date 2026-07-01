import { Prisma } from "@prisma/client";

// Postgres raises SQLSTATE 23P01 (exclusion_violation) when a write would break
// the no-double-book EXCLUDE (`vehicle_occupancy_no_overlap`, via the occupancy
// trigger). Depending on the path, Prisma surfaces it as a known-request error
// with the PG code in `meta`, or as a generic error whose message carries the
// code / constraint name. Recognise all shapes so callers can degrade to a
// friendly "vehicleBusy" instead of a 500.
export function isExclusionViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const metaCode = (err.meta as { code?: string } | undefined)?.code;
    if (metaCode === "23P01") return true;
  }
  return (
    err instanceof Error &&
    /23P01|exclusion_violation|vehicle_occupancy_no_overlap/i.test(err.message)
  );
}
