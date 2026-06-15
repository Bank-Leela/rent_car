// Car = driver pairing helpers (1:1). The pairing is persisted on
// Vehicle.assignedDriverId; these helpers compute a default pairing and a fast
// lookup used by the matcher and the schedule board.

export interface CarRef {
  id: string;
}
export interface DriverRef {
  id: string;
}
export interface VehicleDriverPair {
  vehicleId: string;
  driverId: string;
}

/**
 * Stable default pairing: sort both by id, zip. Extra cars (more cars than
 * drivers) are left unpaired; extra drivers are ignored.
 */
export function pairCarsToDrivers(cars: CarRef[], drivers: DriverRef[]): VehicleDriverPair[] {
  const c = [...cars].sort((a, b) => a.id.localeCompare(b.id));
  const d = [...drivers].sort((a, b) => a.id.localeCompare(b.id));
  const pairs: VehicleDriverPair[] = [];
  for (let i = 0; i < c.length && i < d.length; i++) {
    pairs.push({ vehicleId: c[i]!.id, driverId: d[i]!.id });
  }
  return pairs;
}

/** vehicleId -> assignedDriverId, omitting unpaired cars. */
export function vehicleDriverMap(
  vehicles: { id: string; assignedDriverId: string | null }[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of vehicles) if (v.assignedDriverId) m.set(v.id, v.assignedDriverId);
  return m;
}
