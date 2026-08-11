import { describe, it, expect } from "vitest";
import type { JobType } from "@prisma/client";
import { recommendPlacement, type RecoDriver } from "./placement-reco";

const D = (s: string) => new Date(s);
const trip = (s: string, e: string, jobType: JobType = "NORMAL") => ({ startAt: D(s), endAt: D(e), jobType });
const drv = (id: string, o: Partial<RecoDriver> = {}): RecoDriver => ({
  driverId: id,
  vehicleId: `v${id}`,
  registrationNumber: `R${id}`,
  driverName: id,
  earningsScore: 0,
  lastAssignedAt: null,
  trips: [],
  ...o,
});

describe("recommendPlacement", () => {
  const booking = { startAt: D("2026-06-10T13:00:00"), endAt: D("2026-06-10T15:00:00"), jobType: "NORMAL" as JobType };
  const overlap = [trip("2026-06-10T13:00:00", "2026-06-10T15:00:00")];
  const base = { booking, needsSecondary: false as boolean, dutyDriverId: null as string | null };

  it("picks the fairest free non-duty car", () => {
    const r = recommendPlacement({
      ...base,
      dutyDriverId: "A",
      drivers: [drv("A", { earningsScore: 0 }), drv("B", { earningsScore: 5 }), drv("C", { earningsScore: 2 })],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "C", vehicleId: "vC", secondaryDriverId: null });
  });

  it("excludes a driver whose trip overlaps the booking", () => {
    const r = recommendPlacement({
      ...base,
      drivers: [drv("B", { earningsScore: 0, trips: overlap }), drv("C", { earningsScore: 9 })],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "C" });
  });

  it("respects the 2-hour gap — never recommends a slot <2h after an existing trip", () => {
    // The bug: a 05:00–09:00 trip does not OVERLAP a 09:00–11:00 booking, but the
    // gap is 0h. The reco must reject it (only P'Top may override by hand).
    const r = recommendPlacement({
      booking: { startAt: D("2026-06-10T09:00:00"), endAt: D("2026-06-10T11:00:00"), jobType: "NORMAL" },
      needsSecondary: false,
      dutyDriverId: null,
      drivers: [drv("B", { trips: [trip("2026-06-10T05:00:00", "2026-06-10T09:00:00", "OT")] })],
    });
    expect(r).toEqual({ kind: "none" });
  });

  it("respects the 2-job NORMAL cap — a driver already on 2 NORMALs is not recommended", () => {
    const r = recommendPlacement({
      ...base,
      drivers: [
        drv("B", {
          trips: [trip("2026-06-10T06:00:00", "2026-06-10T08:00:00"), trip("2026-06-10T09:00:00", "2026-06-10T11:00:00")],
        }),
      ],
    });
    expect(r).toEqual({ kind: "none" });
  });

  it("OT is exempt from the cap — recommendable on top of 2 NORMALs if the gap holds", () => {
    const r = recommendPlacement({
      booking: { startAt: D("2026-06-10T17:00:00"), endAt: D("2026-06-10T21:00:00"), jobType: "OT" },
      needsSecondary: false,
      dutyDriverId: null,
      drivers: [
        drv("B", {
          trips: [trip("2026-06-10T06:00:00", "2026-06-10T08:00:00"), trip("2026-06-10T09:00:00", "2026-06-10T11:00:00")],
        }),
      ],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "B" });
  });

  it("falls back to the duty car (reclaim) when no non-duty car is free", () => {
    const r = recommendPlacement({ ...base, dutyDriverId: "A", drivers: [drv("A"), drv("B", { trips: overlap })] });
    expect(r).toMatchObject({ kind: "reclaim", driverId: "A", vehicleId: "vA" });
  });

  it("none when nobody is free and there's no duty car", () => {
    const r = recommendPlacement({ ...base, drivers: [drv("B", { trips: overlap })] });
    expect(r).toEqual({ kind: "none" });
  });

  // §5: overlap is the one constraint a manual override may never relax, "not
  // even the duty car". Reclaim pulls the duty driver off STANDBY; a duty driver
  // already ON a trip in that window has nothing to reclaim.
  it("does NOT offer reclaim when the duty driver's own trip overlaps", () => {
    const r = recommendPlacement({
      ...base,
      dutyDriverId: "A",
      drivers: [drv("A", { trips: overlap }), drv("B", { trips: overlap })],
    });
    expect(r).toEqual({ kind: "none" });
  });

  // The consequence that made this worth fixing: dayHasRoomFor reads any
  // non-`none` placement as "the fleet can serve this", so a bare existence check
  // on the duty driver made the approval capacity gate pass every full day that
  // had a เวร rostered — which is every day.
  it("reports a genuinely full fleet as none, duty rostered or not", () => {
    const everyoneBusy = ["A", "B", "C"].map((id) => drv(id, { trips: overlap }));
    expect(recommendPlacement({ ...base, dutyDriverId: "A", drivers: everyoneBusy })).toEqual({ kind: "none" });
    expect(recommendPlacement({ ...base, dutyDriverId: null, drivers: everyoneBusy })).toEqual({ kind: "none" });
  });

  it("still offers reclaim when the duty driver is merely inside the 2h gap", () => {
    // The gap IS P'Top's to override, so a duty driver who is only gap-blocked
    // remains a legitimate reclaim candidate — this is the half of canChain that
    // reclaim deliberately skips.
    const r = recommendPlacement({
      ...base,
      dutyDriverId: "A",
      drivers: [
        drv("A", { trips: [trip("2026-06-10T11:30:00", "2026-06-10T12:30:00")] }), // ends 30 min before
        drv("B", { trips: overlap }),
      ],
    });
    expect(r).toMatchObject({ kind: "reclaim", driverId: "A" });
  });

  it("skips an unpaired driver (no car)", () => {
    const r = recommendPlacement({ ...base, drivers: [drv("B", { vehicleId: null })] });
    expect(r).toEqual({ kind: "none" });
  });

  it("recommends a co-driver (next-fairest free) for a >400 km trip", () => {
    const r = recommendPlacement({
      ...base,
      needsSecondary: true,
      drivers: [drv("B", { earningsScore: 1 }), drv("C", { earningsScore: 2 }), drv("D", { earningsScore: 3 })],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "B", secondaryDriverId: "C" });
  });

  it("co-driver is null when only one driver is free", () => {
    const r = recommendPlacement({
      ...base,
      needsSecondary: true,
      drivers: [drv("B"), drv("C", { trips: overlap })],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "B", secondaryDriverId: null });
  });
});

describe("recommendPlacement — gap boundary, cap shape, reclaim", () => {
  const morning = { startAt: D("2026-06-10T09:00:00"), endAt: D("2026-06-10T11:00:00"), jobType: "NORMAL" as JobType };
  const afternoon = { startAt: D("2026-06-10T13:00:00"), endAt: D("2026-06-10T15:00:00"), jobType: "NORMAL" as JobType };

  it("exact 2h gap → fit; one minute short → none (existing OT, so the cap isn't the cause)", () => {
    const ok = recommendPlacement({
      booking: morning, needsSecondary: false, dutyDriverId: null,
      drivers: [drv("B", { trips: [trip("2026-06-10T05:00:00", "2026-06-10T07:00:00", "OT")] })],
    });
    expect(ok.kind).toBe("fit"); // ends 07:00, +2h = 09:00 == start
    const bad = recommendPlacement({
      booking: morning, needsSecondary: false, dutyDriverId: null,
      drivers: [drv("B", { trips: [trip("2026-06-10T05:00:00", "2026-06-10T07:01:00", "OT")] })],
    });
    expect(bad.kind).toBe("none"); // 1 minute short of 2h
  });

  it("NORMAL cap shape: a second morning (both end ≤12) is rejected → none", () => {
    const r = recommendPlacement({
      booking: morning, needsSecondary: false, dutyDriverId: null,
      drivers: [drv("B", { trips: [trip("2026-06-10T05:00:00", "2026-06-10T07:00:00")] })], // 2h gap, both mornings
    });
    expect(r.kind).toBe("none");
  });

  it("only the duty car can take it → reclaim (its driver + car)", () => {
    const r = recommendPlacement({
      booking: afternoon, needsSecondary: false, dutyDriverId: "A",
      drivers: [drv("A"), drv("B", { trips: [trip("2026-06-10T13:00:00", "2026-06-10T15:00:00")] })],
    });
    expect(r).toMatchObject({ kind: "reclaim", driverId: "A", vehicleId: "vA" });
  });

  it("duty driver has no car → none, not reclaim", () => {
    const r = recommendPlacement({
      booking: afternoon, needsSecondary: false, dutyDriverId: "A",
      drivers: [drv("A", { vehicleId: null }), drv("B", { trips: [trip("2026-06-10T13:00:00", "2026-06-10T15:00:00")] })],
    });
    expect(r).toEqual({ kind: "none" });
  });

  it("reclaim with needsSecondary but no free co-driver → secondaryDriverId null", () => {
    const r = recommendPlacement({
      booking: { ...afternoon, jobType: "TJW" }, needsSecondary: true, dutyDriverId: "A",
      drivers: [drv("A"), drv("B", { trips: [trip("2026-06-10T13:00:00", "2026-06-10T15:00:00")] })],
    });
    expect(r).toMatchObject({ kind: "reclaim", secondaryDriverId: null });
  });

  it("a long trip gets the next-fairest free non-duty co-driver", () => {
    const r = recommendPlacement({
      booking: { ...afternoon, jobType: "TJW" }, needsSecondary: true, dutyDriverId: null,
      drivers: [drv("B", { earningsScore: 1 }), drv("C", { earningsScore: 2 })],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "B", secondaryDriverId: "C" });
  });
});

describe("recommendPlacement — WERN goes to the duty driver", () => {
  it("recommends the on-call driver for a WERN slot, not the free non-duty pool", () => {
    const r = recommendPlacement({
      booking: { startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T12:00:00"), jobType: "WERN" },
      needsSecondary: false,
      dutyDriverId: "A",
      // Without the fix, A (duty) is filtered out and B is recommended.
      drivers: [drv("A"), drv("B")],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "A", vehicleId: "vA", secondaryDriverId: null });
  });

  it("WERN with a CARLESS duty driver → none, never a non-duty driver", () => {
    // Duty driver A has no car (e.g. unpaired after a fleet change). A WERN slot
    // belongs to the duty driver alone — must NOT be handed to free non-duty B.
    const r = recommendPlacement({
      booking: { startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T12:00:00"), jobType: "WERN" },
      needsSecondary: false,
      dutyDriverId: "A",
      drivers: [drv("A", { vehicleId: null }), drv("B")],
    });
    expect(r).toEqual({ kind: "none" });
  });

  it("WERN with no duty rostered → none, never a non-duty driver", () => {
    const r = recommendPlacement({
      booking: { startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T12:00:00"), jobType: "WERN" },
      needsSecondary: false,
      dutyDriverId: null,
      drivers: [drv("B"), drv("C")],
    });
    expect(r).toEqual({ kind: "none" });
  });
});
