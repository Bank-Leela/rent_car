import { describe, expect, it } from "vitest";
import { buildDriverRounds, type RoundsBookingInput } from "./driver-rounds";

const D = (s: string) => new Date(s);
const dayStart = D("2026-08-10T00:00:00");
const dayEnd = D("2026-08-11T00:00:00");

// The board shows the car by type, not by plate — the rows carry a translated
// type label (the caller resolves it; this module is i18n-free).
const drivers = [
  { driverId: "A", driverName: "สมชาย", vehicleTypeLabel: "ตู้" },
  { driverId: "B", driverName: "สุนีย์", vehicleTypeLabel: "เก๋ง" },
  { driverId: "C", driverName: "ประเสริฐ", vehicleTypeLabel: null },
];

const bk = (over: Partial<RoundsBookingInput> & { id: string }): RoundsBookingInput => ({
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

  it("carries the car TYPE onto the row, and no plate", () => {
    const rows = build([bk({ id: "1" })]);
    expect(rows.map((r) => r.vehicleTypeLabel)).toEqual(["ตู้", "เก๋ง", null]);
    // The plate is not part of this view model at all — the board is read across
    // a room, and a registration number is not what a driver acts on.
    expect(rows[0]).not.toHaveProperty("registrationNumber");
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

  it("labels each day of an overnight trip by what happens THAT day", () => {
    // 10 Aug 06:00 → 13 Aug 18:00 = 3 nights.
    const tjw = bk({
      id: "tjw", jobType: "TJW", destination: "เชียงใหม่",
      startAt: D("2026-08-10T06:00:00"), endAt: D("2026-08-13T18:00:00"),
    });
    const on = (day: string) => {
      const ds = D(`${day}T00:00:00`);
      const de = new Date(ds); de.setDate(de.getDate() + 1);
      return buildDriverRounds({ drivers, bookings: [tjw], dayStart: ds, dayEnd: de, dutyDriverId: null })
        .find((r) => r.driverId === "A")!.rounds[0]!;
    };

    const depart = on("2026-08-10");
    expect(depart.phase).toBe("depart");
    expect(depart.startLabel).toBe("06:00"); // real departure time, not a day edge
    expect(depart.nightTotal).toBe(3);

    const away = on("2026-08-11");
    expect(away.phase).toBe("away");
    expect(away.nightIndex).toBe(2); // 10th was night 1
    expect(away.nightTotal).toBe(3);

    const back = on("2026-08-13");
    expect(back.phase).toBe("return");
    expect(back.endLabel).toBe("18:00"); // real return time
    expect(back.nightIndex).toBeNull();
  });

  it("a same-day trip stays a plain start–end round", () => {
    const rows = build([bk({ id: "normal" })]);
    const r = rows.find((x) => x.driverId === "A")!.rounds[0]!;
    expect(r.phase).toBe("single");
    expect(r.nightIndex).toBeNull();
    expect(r.nightTotal).toBeNull();
  });

  it("ignores trips assigned to a driver outside the shown pool", () => {
    const rows = build([bk({ id: "ghost", primaryDriverId: "ZZZ" })]);
    expect(rows.every((r) => r.rounds.length === 0)).toBe(true);
  });
});
