import { describe, expect, it } from "vitest";
import type { TimeBucket } from "@prisma/client";
import {
  allocateVehicles,
  bucketFromStart,
  buildSlotTable,
  findSlot,
  vehicleOccupancyForDay,
  TIME_BUCKETS,
  type SlotInput,
  type ExistingTrip,
} from "./slot-allocation";

describe("bucketFromStart", () => {
  it("maps the four ranges", () => {
    expect(bucketFromStart(new Date("2026-06-10T07:30:00"))).toBe("BEFORE_08");
    expect(bucketFromStart(new Date("2026-06-10T08:00:00"))).toBe("MORNING_08_12");
    expect(bucketFromStart(new Date("2026-06-10T11:59:00"))).toBe("MORNING_08_12");
    expect(bucketFromStart(new Date("2026-06-10T12:00:00"))).toBe("AFTERNOON_12_16");
    expect(bucketFromStart(new Date("2026-06-10T15:59:00"))).toBe("AFTERNOON_12_16");
    expect(bucketFromStart(new Date("2026-06-10T16:00:00"))).toBe("AFTER_16");
    expect(bucketFromStart(new Date("2026-06-10T22:00:00"))).toBe("AFTER_16");
  });
});

describe("buildSlotTable", () => {
  const vehicles: SlotInput[] = [
    { vehicleId: "v1", registrationNumber: "B-2", isDutyVehicle: false },
    { vehicleId: "v2", registrationNumber: "B-1", isDutyVehicle: false },
    { vehicleId: "duty", registrationNumber: "DUTY", isDutyVehicle: true },
  ];

  it("places duty vehicles last and sorts the rest by registration", () => {
    const table = buildSlotTable(vehicles, []);
    expect(table.map((row) => row[0]!.vehicleId)).toEqual(["v2", "v1", "duty"]);
  });

  it("marks cells busy when an existing trip occupies them", () => {
    const existing: ExistingTrip[] = [
      { vehicleId: "v1", timeBucket: "MORNING_08_12" },
      { vehicleId: "duty", timeBucket: "AFTER_16" },
    ];
    const table = buildSlotTable(vehicles, existing);
    const v1Row = table.find((r) => r[0]!.vehicleId === "v1")!;
    expect(v1Row.find((c) => c.bucket === "MORNING_08_12")!.busy).toBe(true);
    expect(v1Row.find((c) => c.bucket === "AFTER_16")!.busy).toBe(false);
    const dutyRow = table.find((r) => r[0]!.vehicleId === "duty")!;
    expect(dutyRow.find((c) => c.bucket === "AFTER_16")!.busy).toBe(true);
  });

  it("CR-06: pre-blocks duty vehicle's morning + afternoon (campus rounds)", () => {
    const table = buildSlotTable(vehicles, []);
    const dutyRow = table.find((r) => r[0]!.vehicleId === "duty")!;
    expect(dutyRow.find((c) => c.bucket === "MORNING_08_12")!.busy).toBe(true);
    expect(dutyRow.find((c) => c.bucket === "AFTERNOON_12_16")!.busy).toBe(true);
    // Before-08 and after-16 remain free on duty vehicle.
    expect(dutyRow.find((c) => c.bucket === "BEFORE_08")!.busy).toBe(false);
    expect(dutyRow.find((c) => c.bucket === "AFTER_16")!.busy).toBe(false);
  });

  it("emits one column per defined bucket", () => {
    const table = buildSlotTable(vehicles, []);
    expect(table[0]).toHaveLength(TIME_BUCKETS.length);
  });
});

describe("findSlot", () => {
  const vehicles: SlotInput[] = [
    { vehicleId: "v1", registrationNumber: "B-1", isDutyVehicle: false },
    { vehicleId: "duty", registrationNumber: "DUTY", isDutyVehicle: true },
  ];

  it("returns the first free non-duty cell in the bucket", () => {
    const table = buildSlotTable(vehicles, []);
    expect(findSlot("MORNING_08_12", table)?.vehicleId).toBe("v1");
  });

  it("falls back to the duty vehicle for fringe buckets (before-08 / after-16)", () => {
    const table = buildSlotTable(vehicles, [
      { vehicleId: "v1", timeBucket: "AFTER_16" },
    ]);
    expect(findSlot("AFTER_16", table)?.vehicleId).toBe("duty");
  });

  it("never falls back to the duty vehicle for morning or afternoon (pre-blocked)", () => {
    const table = buildSlotTable(vehicles, [
      { vehicleId: "v1", timeBucket: "MORNING_08_12" },
    ]);
    expect(findSlot("MORNING_08_12", table)).toBeNull();
  });

  it("returns null when every vehicle is busy in that bucket", () => {
    const table = buildSlotTable(vehicles, [
      { vehicleId: "v1", timeBucket: "AFTER_16" },
      { vehicleId: "duty", timeBucket: "AFTER_16" },
    ]);
    expect(findSlot("AFTER_16", table)).toBeNull();
  });
});

describe("allocateVehicles (C1: no free vehicle -> overflow, never assign vehicleless)", () => {
  const vehicles: SlotInput[] = [
    { vehicleId: "v1", registrationNumber: "B-1", isDutyVehicle: false },
    { vehicleId: "v2", registrationNumber: "B-2", isDutyVehicle: false },
    { vehicleId: "duty", registrationNumber: "DUTY", isDutyVehicle: true },
  ];
  const bucketOf = (m: Record<string, TimeBucket>) => (id: string) => m[id]!;

  it("assigns distinct vehicles when capacity suffices", () => {
    const r = allocateVehicles(
      [{ bookingId: "a" }, { bookingId: "b" }],
      bucketOf({ a: "MORNING_08_12", b: "MORNING_08_12" }),
      buildSlotTable(vehicles, []),
    );
    expect(r.noVehicle).toHaveLength(0);
    expect(new Set(r.withVehicle.map((w) => w.vehicleId)).size).toBe(2);
  });

  it("overflows the excess when a bucket has more bookings than free vehicles", () => {
    // 3 morning bookings, only 2 non-duty vehicles free (duty pre-blocked in morning).
    const r = allocateVehicles(
      [{ bookingId: "a" }, { bookingId: "b" }, { bookingId: "c" }],
      bucketOf({ a: "MORNING_08_12", b: "MORNING_08_12", c: "MORNING_08_12" }),
      buildSlotTable(vehicles, []),
    );
    expect(r.withVehicle).toHaveLength(2);
    expect(r.noVehicle.map((i) => i.bookingId)).toEqual(["c"]);
    expect(r.withVehicle.every((w) => w.vehicleId !== "duty")).toBe(true); // never the pre-blocked duty car
  });

  it("uses the duty vehicle for fringe buckets (after-16) so all three fit", () => {
    const r = allocateVehicles(
      [{ bookingId: "a" }, { bookingId: "b" }, { bookingId: "c" }],
      bucketOf({ a: "AFTER_16", b: "AFTER_16", c: "AFTER_16" }),
      buildSlotTable(vehicles, []),
    );
    expect(r.noVehicle).toHaveLength(0);
    expect(r.withVehicle.map((w) => w.vehicleId).sort()).toEqual(["duty", "v1", "v2"]);
  });
});

describe("vehicleOccupancyForDay (C2: multi-day trips occupy the vehicle every spanned day)", () => {
  const D = (s: string) => new Date(s);
  const day = D("2026-06-10T00:00:00");

  it("a same-day trip occupies only its own bucket", () => {
    const occ = vehicleOccupancyForDay(
      [{ vehicleId: "v1", startAt: D("2026-06-10T09:00:00"), endAt: D("2026-06-10T11:00:00"), timeBucket: "MORNING_08_12" }],
      day,
    );
    expect(occ).toEqual([{ vehicleId: "v1", timeBucket: "MORNING_08_12" }]);
  });

  it("a multi-day TJW started yesterday blocks the vehicle in EVERY bucket today (the C2 leak)", () => {
    const occ = vehicleOccupancyForDay(
      [{ vehicleId: "v1", startAt: D("2026-06-09T06:00:00"), endAt: D("2026-06-11T18:00:00"), timeBucket: "BEFORE_08" }],
      day,
    );
    expect(occ.map((o) => o.timeBucket).sort()).toEqual([...TIME_BUCKETS].sort());
    expect(occ.every((o) => o.vehicleId === "v1")).toBe(true);
  });

  it("a TJW starting today but ending tomorrow also blocks all buckets today", () => {
    const occ = vehicleOccupancyForDay(
      [{ vehicleId: "v1", startAt: D("2026-06-10T06:00:00"), endAt: D("2026-06-11T14:00:00"), timeBucket: "BEFORE_08" }],
      day,
    );
    expect(occ).toHaveLength(TIME_BUCKETS.length);
  });

  it("skips trips with no vehicle", () => {
    const occ = vehicleOccupancyForDay(
      [{ vehicleId: null, startAt: D("2026-06-09T06:00:00"), endAt: D("2026-06-11T18:00:00"), timeBucket: "BEFORE_08" }],
      day,
    );
    expect(occ).toEqual([]);
  });
});
