"use server";

import { format } from "date-fns";
import { th, enUS } from "date-fns/locale";
import { getLocale } from "next-intl/server";
import type { BookingStatus, JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { isStationEmail } from "@/lib/auth/station";

export type StationTripDetail = {
  id: string;
  status: BookingStatus;
  jobType: JobType;
  purpose: string;
  destination: string;
  province: string;
  startLabel: string;
  endLabel: string;
  estimatedDistance: number | null;
  departmentName: string | null;
  requesterName: string | null;
  registrationNumber: string | null;
  primaryDriverName: string | null;
  secondaryDriverName: string | null;
  /** Viewer may start/end the trip (the assigned driver or the shared station). */
  canRecord: boolean;
  trip: {
    startMileage: number;
    endMileage: number | null;
    distanceKm: number | null;
    fuelCost: number | null;
    fuelLiters: number | null;
    fuelType: string | null;
    parkingCost: number | null;
    tollwayCost: number | null;
    usedExpressway: boolean;
    driverNotes: string | null;
    startedLabel: string;
    endedLabel: string | null;
    // Minutes past the scheduled return time (เลิกช้า → OT); 0 if on time.
    overtimeMin: number;
  } | null;
};

export type StationDetailResult = { ok: true; detail: StationTripDetail } | { ok: false; error: string };

// Read-model for the schedule board's trip drawer. The shared station kiosk (a
// DRIVER account with no personal profile) may view ANY booking; a regular driver
// is held to the same rule as /driver/[id] (APPROVED, or their own/claimed trip).
export async function getStationTripDetailAction(bookingId: string): Promise<StationDetailResult> {
  const session = await requireRole("DRIVER");
  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");
  const dfLocale = isThai ? th : enUS;
  const nameOf = (u: { name: string | null; thaiName: string | null } | null | undefined) =>
    u ? (isThai ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? null : null;

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, isActive: true, driverProfile: { select: { id: true } } },
  });
  const meId = me?.driverProfile?.id ?? null;
  // Kiosk = the allowlisted, ACTIVE station account ONLY — never "any profile-less driver".
  const isStation = !!me?.isActive && isStationEmail(me.email);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, status: true, jobType: true, purpose: true,
      destination: true, province: true, startAt: true, endAt: true, estimatedDistance: true,
      primaryDriverId: true, secondaryDriverId: true,
      department: { select: { nameEn: true, nameTh: true } },
      requester: { select: { name: true, thaiName: true } },
      vehicle: { select: { registrationNumber: true } },
      primaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      secondaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      claims: { where: { status: "ACTIVE" }, select: { driverId: true } },
      trip: true,
    },
  });
  if (!booking) return { ok: false, error: "bookingNotFound" };

  // Guard meId != null: otherwise a profile-less viewer (meId null) "matches" a
  // booking whose secondaryDriverId is also null (null === null).
  const isOwn = meId != null && (booking.primaryDriverId === meId || booking.secondaryDriverId === meId);
  const isClaimed = !!meId && booking.claims.some((c) => c.driverId === meId);
  if (!isStation && booking.status !== "APPROVED" && !isOwn && !isClaimed) {
    return { ok: false, error: "forbidden" };
  }

  const t = booking.trip;
  return {
    ok: true,
    detail: {
      id: booking.id,
      status: booking.status,
      jobType: booking.jobType,
      purpose: booking.purpose,
      destination: booking.destination,
      province: booking.province,
      startLabel: format(booking.startAt, "EEE d MMM yyyy HH:mm", { locale: dfLocale }),
      endLabel: format(booking.endAt, "EEE d MMM yyyy HH:mm", { locale: dfLocale }),
      estimatedDistance: booking.estimatedDistance,
      departmentName: booking.department?.nameTh ?? null,
      requesterName: nameOf(booking.requester),
      registrationNumber: booking.vehicle?.registrationNumber ?? null,
      primaryDriverName: nameOf(booking.primaryDriver?.user),
      secondaryDriverName: nameOf(booking.secondaryDriver?.user),
      canRecord: isStation || isOwn,
      trip: t
        ? {
            startMileage: t.startMileage,
            endMileage: t.endMileage,
            distanceKm: t.distanceKm,
            fuelCost: t.fuelCost != null ? Number(t.fuelCost) : null,
            fuelLiters: t.fuelLiters != null ? Number(t.fuelLiters) : null,
            fuelType: t.fuelType,
            parkingCost: t.parkingCost != null ? Number(t.parkingCost) : null,
            tollwayCost: t.tollwayCost != null ? Number(t.tollwayCost) : null,
            usedExpressway: t.usedExpressway,
            driverNotes: t.driverNotes,
            startedLabel: format(t.startedAt, "d MMM HH:mm", { locale: dfLocale }),
            endedLabel: t.endedAt ? format(t.endedAt, "d MMM HH:mm", { locale: dfLocale }) : null,
            overtimeMin:
              t.endedAt && t.endedAt > booking.endAt
                ? Math.ceil((t.endedAt.getTime() - booking.endAt.getTime()) / 60000)
                : 0,
          }
        : null,
    },
  };
}
