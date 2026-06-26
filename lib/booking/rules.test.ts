import { describe, expect, it } from "vitest";
import { addBusinessDays, addHours, addMinutes, startOfDay } from "date-fns";
import {
  BANGKOK_PROVINCE,
  canSubmitForDepartment,
  checkDriverAssignment,
  checkLeadTime,
  findBufferConflicts,
  hasBufferConflict,
  isBlockedByPendingEvaluation,
  isWithinWorkHours,
  LEAD_TIME_BANGKOK_DAYS,
  LEAD_TIME_OUTSIDE_DAYS,
  LEAD_TIME_URGENT_DAYS,
  shouldWarnAboutCancellations,
  TWO_DRIVER_DISTANCE_KM,
  VEHICLE_BUFFER_MINUTES,
  WORK_END_HOUR,
  WORK_START_HOUR,
} from "./rules";

const NOW = new Date("2026-06-01T09:00:00Z");

describe("checkLeadTime", () => {
  it("Bangkok bookings need LEAD_TIME_BANGKOK_DAYS lead time", () => {
    const justBeforeMin = addBusinessDays(NOW, LEAD_TIME_BANGKOK_DAYS - 1);
    const exactlyAtMin = addBusinessDays(NOW, LEAD_TIME_BANGKOK_DAYS);

    expect(checkLeadTime({ startAt: justBeforeMin, province: BANGKOK_PROVINCE, now: NOW }).ok).toBe(false);
    expect(checkLeadTime({ startAt: exactlyAtMin, province: BANGKOK_PROVINCE, now: NOW }).ok).toBe(true);
  });

  it("out-of-province bookings need LEAD_TIME_OUTSIDE_DAYS lead time", () => {
    const justBeforeMin = addBusinessDays(NOW, LEAD_TIME_OUTSIDE_DAYS - 1);
    const exactlyAtMin = addBusinessDays(NOW, LEAD_TIME_OUTSIDE_DAYS);

    expect(checkLeadTime({ startAt: justBeforeMin, province: "เชียงใหม่", now: NOW }).ok).toBe(false);
    expect(checkLeadTime({ startAt: exactlyAtMin, province: "เชียงใหม่", now: NOW }).ok).toBe(true);
  });

  it("urgent requests collapse the lead time to LEAD_TIME_URGENT_DAYS, overriding province", () => {
    // A date that is far too soon for an out-of-province trip...
    const soon = addBusinessDays(NOW, LEAD_TIME_URGENT_DAYS);
    expect(checkLeadTime({ startAt: soon, province: "เชียงใหม่", now: NOW }).ok).toBe(false);
    // ...is allowed once the request is marked urgent.
    expect(checkLeadTime({ startAt: soon, province: "เชียงใหม่", urgent: true, now: NOW }).ok).toBe(true);

    // Still enforces the 1-day floor — same-day urgent is rejected.
    const tooSoon = addBusinessDays(NOW, LEAD_TIME_URGENT_DAYS - 1);
    const res = checkLeadTime({ startAt: tooSoon, province: BANGKOK_PROVINCE, urgent: true, now: NOW });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.minimumDays).toBe(LEAD_TIME_URGENT_DAYS);
  });

  it("returns the minimum allowed start when too soon (midnight on the lead-time day)", () => {
    const result = checkLeadTime({ startAt: NOW, province: BANGKOK_PROVINCE, now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.minimumDays).toBe(LEAD_TIME_BANGKOK_DAYS);
      expect(result.minimumStartAt.getTime()).toBe(
        startOfDay(addBusinessDays(NOW, LEAD_TIME_BANGKOK_DAYS)).getTime(),
      );
    }
  });

  it("allows any time on the lead-time boundary day", () => {
    const earlyOnBoundaryDay = startOfDay(addBusinessDays(NOW, LEAD_TIME_BANGKOK_DAYS));
    const lateOnBoundaryDay = addHours(earlyOnBoundaryDay, 23);
    expect(checkLeadTime({ startAt: earlyOnBoundaryDay, province: BANGKOK_PROVINCE, now: NOW }).ok).toBe(true);
    expect(checkLeadTime({ startAt: lateOnBoundaryDay, province: BANGKOK_PROVINCE, now: NOW }).ok).toBe(true);
  });
});

describe("checkDriverAssignment", () => {
  it("rejects when no primary driver", () => {
    const result = checkDriverAssignment({
      estimatedDistance: 100,
      primaryDriverId: null,
      secondaryDriverId: null,
    });
    expect(result).toEqual({ ok: false, reason: "PRIMARY_REQUIRED" });
  });

  it("under 400 km, secondary is optional", () => {
    expect(
      checkDriverAssignment({
        estimatedDistance: 100,
        primaryDriverId: "drv-1",
        secondaryDriverId: null,
      }),
    ).toEqual({ ok: true });
  });

  it("over 400 km, secondary is required", () => {
    expect(
      checkDriverAssignment({
        estimatedDistance: TWO_DRIVER_DISTANCE_KM + 1,
        primaryDriverId: "drv-1",
        secondaryDriverId: null,
      }),
    ).toEqual({ ok: false, reason: "SECONDARY_REQUIRED" });
  });

  it("exactly 400 km does not require secondary (boundary is strict >)", () => {
    expect(
      checkDriverAssignment({
        estimatedDistance: TWO_DRIVER_DISTANCE_KM,
        primaryDriverId: "drv-1",
        secondaryDriverId: null,
      }),
    ).toEqual({ ok: true });
  });

  it("primary and secondary cannot be the same person", () => {
    expect(
      checkDriverAssignment({
        estimatedDistance: 500,
        primaryDriverId: "drv-1",
        secondaryDriverId: "drv-1",
      }),
    ).toEqual({ ok: false, reason: "DUPLICATE_DRIVER" });
  });

  it("missing distance does not force secondary", () => {
    expect(
      checkDriverAssignment({
        estimatedDistance: null,
        primaryDriverId: "drv-1",
        secondaryDriverId: null,
      }),
    ).toEqual({ ok: true });
  });
});

describe("hasBufferConflict", () => {
  const base: { startAt: Date; endAt: Date } = {
    startAt: new Date("2026-06-10T08:00:00Z"),
    endAt: new Date("2026-06-10T12:00:00Z"),
  };

  it("flags overlapping windows", () => {
    expect(
      hasBufferConflict(base, {
        startAt: new Date("2026-06-10T11:00:00Z"),
        endAt: new Date("2026-06-10T13:00:00Z"),
      }),
    ).toBe(true);
  });

  it("flags gaps shorter than the buffer", () => {
    expect(
      hasBufferConflict(base, {
        startAt: addMinutes(base.endAt, VEHICLE_BUFFER_MINUTES - 1),
        endAt: addMinutes(base.endAt, VEHICLE_BUFFER_MINUTES + 60),
      }),
    ).toBe(true);
  });

  it("allows gaps at or above the buffer", () => {
    expect(
      hasBufferConflict(base, {
        startAt: addMinutes(base.endAt, VEHICLE_BUFFER_MINUTES),
        endAt: addMinutes(base.endAt, VEHICLE_BUFFER_MINUTES + 60),
      }),
    ).toBe(false);
  });

  it("works symmetrically (existing booking before candidate, gap < buffer)", () => {
    const earlier = {
      startAt: addHours(base.startAt, -2),
      endAt: addMinutes(base.startAt, -30),
    };
    expect(hasBufferConflict(base, earlier)).toBe(true);
  });
});

describe("findBufferConflicts", () => {
  it("returns only the conflicting bookings", () => {
    const candidate = {
      startAt: new Date("2026-06-10T08:00:00Z"),
      endAt: new Date("2026-06-10T12:00:00Z"),
    };
    const existing = [
      {
        id: "ok-far-before",
        startAt: new Date("2026-06-10T00:00:00Z"),
        endAt: new Date("2026-06-10T03:00:00Z"),
      },
      {
        id: "conflict-overlap",
        startAt: new Date("2026-06-10T11:30:00Z"),
        endAt: new Date("2026-06-10T13:00:00Z"),
      },
      {
        id: "conflict-gap",
        startAt: addMinutes(candidate.endAt, 30),
        endAt: addMinutes(candidate.endAt, 90),
      },
    ];
    const conflicts = findBufferConflicts(candidate, existing);
    expect(conflicts.map((c) => c.id).sort()).toEqual(["conflict-gap", "conflict-overlap"]);
  });
});

describe("warnings + gating", () => {
  it("warns at 3+ cancellations", () => {
    expect(shouldWarnAboutCancellations(2)).toBe(false);
    expect(shouldWarnAboutCancellations(3)).toBe(true);
    expect(shouldWarnAboutCancellations(4)).toBe(true);
  });

  it("blocks new bookings when an evaluation is pending", () => {
    expect(isBlockedByPendingEvaluation(0)).toBe(false);
    expect(isBlockedByPendingEvaluation(1)).toBe(true);
  });
});

describe("isWithinWorkHours", () => {
  const date = (h: number, m = 0, day = 10) =>
    new Date(2026, 5, day, h, m, 0, 0); // June 10, 2026 (local)

  it("accepts a same-day trip inside work hours", () => {
    expect(
      isWithinWorkHours({ startAt: date(WORK_START_HOUR), endAt: date(WORK_END_HOUR) }),
    ).toBe(true);
  });

  it("rejects a start before work hours", () => {
    expect(
      isWithinWorkHours({ startAt: date(WORK_START_HOUR - 1, 30), endAt: date(10) }),
    ).toBe(false);
  });

  it("rejects an end after work hours", () => {
    expect(
      isWithinWorkHours({ startAt: date(10), endAt: date(WORK_END_HOUR, 30) }),
    ).toBe(false);
  });

  it("rejects an overnight trip", () => {
    expect(
      isWithinWorkHours({ startAt: date(8, 0, 10), endAt: date(8, 0, 11) }),
    ).toBe(false);
  });
});

describe("canSubmitForDepartment", () => {
  const requester = { id: "user-rep", roles: [{ role: "REQUESTER" }] };
  const otherUser = { id: "user-other", roles: [{ role: "REQUESTER" }] };
  const admin = { id: "user-admin", roles: [{ role: "ADMIN" }] };
  const deptWithRep = { representativeUserId: "user-rep" };
  const deptWithoutRep = { representativeUserId: null };

  it("allows the designated representative", () => {
    expect(canSubmitForDepartment(requester, deptWithRep)).toBe(true);
  });

  it("rejects a non-representative", () => {
    expect(canSubmitForDepartment(otherUser, deptWithRep)).toBe(false);
  });

  it("allows any admin even when they are not the representative", () => {
    expect(canSubmitForDepartment(admin, deptWithRep)).toBe(true);
    expect(canSubmitForDepartment(admin, deptWithoutRep)).toBe(true);
  });

  it("rejects when no representative is set and user is not admin", () => {
    expect(canSubmitForDepartment(requester, deptWithoutRep)).toBe(false);
  });
});
