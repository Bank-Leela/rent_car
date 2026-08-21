import type { PreferredVehicleType, VehicleType } from "@prisma/client";

/**
 * What the requester ASKED FOR → what the owned fleet actually is.
 *
 * These are two different enums. `PreferredVehicleType` is the category on the
 * booking form (รถตู้ / กระบะ / รถเก๋งผู้บริหาร / รถหกล้อ / รถบัสเช่า);
 * `VehicleType` is how the fleet is physically classified. They happen to share
 * the spellings VAN and PICKUP, which is exactly why the mismatch went unnoticed
 * for so long: two of the five values matched by coincidence, so the preference
 * appeared to work while SEDAN_DEAN and TRUCK_6_WHEEL silently matched nothing.
 *
 * `null` means "nothing in the owned fleet can satisfy this" — a bus is always
 * an outside rental, so a BUS_OUTSOURCED preference must not narrow the internal
 * pick at all rather than narrowing it to zero cars.
 *
 * Exhaustive by type: adding a value to PreferredVehicleType without deciding
 * its fleet equivalent is a compile error, not a silent no-match.
 */
export const FLEET_TYPE_FOR_PREFERENCE: Record<PreferredVehicleType, VehicleType | null> = {
  VAN: "VAN",
  PICKUP: "PICKUP",
  SEDAN_DEAN: "SEDAN",
  TRUCK_6_WHEEL: "OTHER",
  BUS_OUTSOURCED: null,
};

/**
 * The fleet type a preference asks for, or null for "no constraint".
 *
 * Every engine that honours §5b must go through this. The preference is a FIRST
 * CHOICE, never a filter — callers fall back to the fairest car of any type, so
 * returning null here simply means the first pass is skipped.
 */
export function fleetTypeFor(preferred: string | null | undefined): VehicleType | null {
  if (!preferred) return null;
  return FLEET_TYPE_FOR_PREFERENCE[preferred as PreferredVehicleType] ?? null;
}
