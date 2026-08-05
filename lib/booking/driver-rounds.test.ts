import { describe, expect, it } from "vitest";
import { buildDriverRounds, type RoundsBookingInput } from "./driver-rounds";

const D = (s: string) => new Date(s);
const dayStart = D("2026-08-10T00:00:00");
const dayEnd = D("2026-08-11T00:00:00");

const drivers = [
  { driverId: "A", driverName: "สมชาย", registrationNumber: "1กก 1111" },
  { driverId: "B", driverName: "สุนีย์", registrationNumber: "2ขข 2222" },
  { driverId: "C", driverName: "ประเสริฐ", registrationNumber: null },
];

const bk = (over: Partial<RoundsBookingInput> & { id: string }): RoundsBookingInput => ({
  jobNumber: `VB-${over.id}`,
  destination: "รพ.จุฬา",
  startAt: D("2026-08-10T09:00:00"),
  endAt: D("2026-08-10T11:00:00"),
  jobType: "NORMAL",
  primaryDriverId: "A",
  secondaryDriverId: null,
  ...over,
});

const build = (bookings: RoundsBookingInput[], dutyDriverId: string | null = null) =>
  buildDriverRounds({ drivers, bookings, dayStart, dayEnd, dutyDriverId });

describe("buildDriverRounds", () => {
  it("gives every driver a row, including idle ones", () => {
    const rows = build([bk({ id: "1" })]);
    expect(rows.map((r) => r.driverId)).toEqual(["A", "B", "C"]);
    expect(rows.find((r) => r.driverId === "C")!.rounds).toEqual([]);
  });

  it("orders a driver's rounds by departure time", () => {
    const rows = build([
      bk({ id: "pm", startAt: D("2026-08-10T13:00:00"), endAt: D("2026-08-10T15:00:00") }),
      bk({ id: "am", startAt: D("2026-08-10T07:30:00"), endAt: D("2026-08-10T09:00:00") }),
    ]);
    const a = rows.find((r) => r.driverId === "A")!;
    expect(a.rounds.map((x) => x.startLabel)).toEqual(["07:30", "13:00"]);
    expect(a.rounds[0]!.endLabel).toBe("09:00");
  });

  it("adds the trip to BOTH the primary and the co-driver, flagging the co-driver", () => {
    const rows = build([bk({ id: "long", primaryDriverId: "A", secondaryDriverId: "B" })]);
    expect(rows.find((r) => r.driverId === "A")!.rounds[0]!.isCoDriver).toBe(false);
    const b = rows.find((r) => r.driverId === "B")!;
    expect(b.rounds).toHaveLength(1);
    expect(b.rounds[0]!.isCoDriver).toBe(true);
  });

  it("clamps a multi-day trip to the viewed day and flags continuation", () => {
    const rows = build([
      bk({ id: "tjw", jobType: "TJW", startAt: D("2026-08-09T06:00:00"), endAt: D("2026-08-12T18:00:00") }),
    ]);
    const r = rows.find((x) => x.driverId === "A")!.rounds[0]!;
    expect(r.startLabel).toBe("00:00");
    expect(r.endLabel).toBe("00:00");
    expect(r.continuesBefore).toBe(true);
    expect(r.continuesAfter).toBe(true);
  });

  it("derives state from the trip actuals and marks the duty driver", () => {
    const rows = build(
      [
        bk({ id: "done", primaryDriverId: "A", tripStartedAt: D("2026-08-10T09:05:00"), tripEndedAt: D("2026-08-10T10:55:00") }),
        bk({ id: "run", primaryDriverId: "B", tripStartedAt: D("2026-08-10T09:05:00") }),
      ],
      "B",
    );
    expect(rows.find((r) => r.driverId === "A")!.rounds[0]!.state).toBe("done");
    expect(rows.find((r) => r.driverId === "B")!.rounds[0]!.state).toBe("inProgress");
    expect(rows.find((r) => r.driverId === "B")!.isDuty).toBe(true);
    expect(rows.find((r) => r.driverId === "A")!.isDuty).toBe(false);
  });

  it("ignores trips assigned to a driver outside the shown pool", () => {
    const rows = build([bk({ id: "ghost", primaryDriverId: "ZZZ" })]);
    expect(rows.every((r) => r.rounds.length === 0)).toBe(true);
  });
});
