import { startOfMonth, endOfMonth, format } from "date-fns";
import { th, enUS, type Locale } from "date-fns/locale";
import { prisma } from "@/lib/db";

function dateFnsLocale(locale?: string): Locale {
  return locale?.toLowerCase().startsWith("th") ? th : enUS;
}

export type DateRange = { from: Date; to: Date };

export function defaultRange(): DateRange {
  const now = new Date();
  return { from: startOfMonth(now), to: endOfMonth(now) };
}

export function rangeFromQuery(qs: { from?: string; to?: string }): DateRange {
  const fallback = defaultRange();
  const from = qs.from ? new Date(qs.from) : fallback.from;
  const to = qs.to ? new Date(qs.to) : fallback.to;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return fallback;
  return { from, to };
}

export async function approvalFunnel(range: DateRange, departmentId?: string) {
  const baseWhere = {
    createdAt: { gte: range.from, lte: range.to },
    ...(departmentId ? { departmentId } : {}),
  };
  const [total, approved, denied, cancelled, completed, outsourced] = await Promise.all([
    prisma.booking.count({ where: baseWhere }),
    prisma.booking.count({ where: { ...baseWhere, status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] } } }),
    prisma.booking.count({ where: { ...baseWhere, status: "DENIED" } }),
    prisma.booking.count({ where: { ...baseWhere, status: "CANCELLED" } }),
    prisma.booking.count({ where: { ...baseWhere, status: "COMPLETED" } }),
    prisma.booking.count({ where: { ...baseWhere, needsOutsourcing: true } }),
  ]);
  return { total, approved, denied, cancelled, completed, outsourced };
}

export async function requestVolumeByMonth(
  range: DateRange,
  departmentId?: string,
  locale?: string,
) {
  const where = {
    createdAt: { gte: range.from, lte: range.to },
    ...(departmentId ? { departmentId } : {}),
  };
  const bookings = await prisma.booking.findMany({
    where,
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const loc = dateFnsLocale(locale);
  const buckets = new Map<string, { label: string; count: number }>();
  for (const b of bookings) {
    const key = format(b.createdAt, "yyyy-MM");
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, { label: format(b.createdAt, "MMM yyyy", { locale: loc }), count: 1 });
    }
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ month: v.label, count: v.count }));
}

export async function requestVolumeByDepartment(range: DateRange) {
  const rows = await prisma.booking.groupBy({
    by: ["departmentId"],
    where: { createdAt: { gte: range.from, lte: range.to } },
    _count: { _all: true },
  });
  if (rows.length === 0) return [];
  const depts = await prisma.department.findMany({
    where: { id: { in: rows.map((r) => r.departmentId) } },
    select: { id: true, nameEn: true },
  });
  const nameById = new Map(depts.map((d) => [d.id, d.nameEn]));
  return rows
    .map((r) => ({ department: nameById.get(r.departmentId) ?? r.departmentId, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

export async function vehicleUtilisation(range: DateRange) {
  const trips = await prisma.trip.findMany({
    where: { startedAt: { gte: range.from, lte: range.to } },
    include: { booking: { select: { vehicleId: true } } },
  });
  const vehicles = await prisma.vehicle.findMany({
    select: { id: true, registrationNumber: true },
  });
  const byVehicle = new Map<
    string,
    { trips: number; km: number; fuel: number; tollway: number; hours: number }
  >();
  for (const t of trips) {
    const vid = t.booking.vehicleId;
    if (!vid) continue;
    const cur = byVehicle.get(vid) ?? { trips: 0, km: 0, fuel: 0, tollway: 0, hours: 0 };
    cur.trips += 1;
    cur.km += t.distanceKm ?? 0;
    cur.fuel += t.fuelCost ? Number(t.fuelCost) : 0;
    cur.tollway += t.tollwayCost ? Number(t.tollwayCost) : 0;
    if (t.endedAt) {
      cur.hours += (t.endedAt.getTime() - t.startedAt.getTime()) / 3_600_000;
    }
    byVehicle.set(vid, cur);
  }
  return vehicles
    .map((v) => ({
      registrationNumber: v.registrationNumber,
      ...(byVehicle.get(v.id) ?? { trips: 0, km: 0, fuel: 0, tollway: 0, hours: 0 }),
    }))
    .sort((a, b) => b.trips - a.trips);
}

export async function driverUtilisation(range: DateRange) {
  const trips = await prisma.trip.findMany({
    where: { startedAt: { gte: range.from, lte: range.to } },
    include: {
      booking: {
        select: {
          primaryDriver: { include: { user: true } },
        },
      },
    },
  });
  const byDriver = new Map<string, { name: string; trips: number; hours: number }>();
  for (const t of trips) {
    const drv = t.booking.primaryDriver;
    if (!drv) continue;
    const name = drv.user.name ?? drv.user.email ?? "(unknown)";
    const cur = byDriver.get(drv.id) ?? { name, trips: 0, hours: 0 };
    cur.trips += 1;
    if (t.endedAt) cur.hours += (t.endedAt.getTime() - t.startedAt.getTime()) / 3_600_000;
    byDriver.set(drv.id, cur);
  }
  return Array.from(byDriver.values()).sort((a, b) => b.trips - a.trips);
}

export async function repeatCancellers(range: DateRange) {
  const rows = await prisma.cancellation.groupBy({
    by: ["cancelledByUserId"],
    where: { cancelledAt: { gte: range.from, lte: range.to } },
    _count: { _all: true },
    orderBy: { _count: { cancelledByUserId: "desc" } },
  });
  if (rows.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.cancelledByUserId) } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const u = byId.get(r.cancelledByUserId);
    return {
      userId: r.cancelledByUserId,
      name: u?.name ?? u?.email ?? "(unknown)",
      cancellations: r._count._all,
    };
  });
}
