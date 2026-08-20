import { NextResponse } from "next/server";
import { addDays, startOfDay, format } from "date-fns";
import { prisma } from "@/lib/db";
import { getCronSecret, isValidCronAuth } from "@/lib/config/cron";
import { runBatchForDay, BATCH_SOLVABLE_WHERE } from "@/lib/booking/batch-core";

// Daily round-scheduling (จัดรอบ) auto-run. A systemd timer / crontab POSTs here
// each evening with `Authorization: Bearer <CRON_SECRET>`. Since จัด now runs on
// approval, this is the SAFETY NET: it sweeps every day that still has
// approved-but-unassigned bookings (plus tomorrow), so anything that became
// placeable later gets picked up. `?date=` still targets exactly one day.
// It previously assigned TOMORROW's
// OT/WERN/NORMAL rounds so the board is set the night before. The manual
// /admin/batch button still works and is idempotent, so both paths coexist.
//
// Fail-closed: no secret configured → 503; wrong/absent bearer → 401.
// TZ note: "tomorrow" is computed in server-local time, which MUST be
// Asia/Bangkok in production (see docs/deployment.md) or the day is wrong.
/**
 * How far ahead the nightly sweep looks. Comfortably past the longest lead time a
 * booking can carry, so a trip is always solved well before its day.
 */
const CRON_SWEEP_HORIZON_DAYS = 60;

export async function POST(req: Request) {
  if (!getCronSecret()) return new NextResponse("not configured", { status: 503 });
  if (!isValidCronAuth(req.headers.get("authorization"))) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  // Default target = tomorrow; `?date=YYYY-MM-DD` overrides for a manual re-run.
  const url = new URL(req.url);
  const override = url.searchParams.get("date");
  // Validate before it reaches runBatchForDay — this is the WRITE path, and an
  // unparseable value would either 500 or, worse, resolve to a day nobody meant.
  if (override !== null && !/^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
  }
  const dateStr = override ?? format(addDays(startOfDay(new Date()), 1), "yyyy-MM-dd");

  // The automated run is attributed to an admin in the audit log (there is no
  // interactive session). Use any active admin.
  const admin = await prisma.user.findFirst({
    where: { isActive: true, roles: { some: { role: "ADMIN" } } },
    select: { id: true },
  });
  if (!admin) return NextResponse.json({ ok: false, error: "no admin to attribute the run" }, { status: 500 });

  // An explicit ?date= still does exactly that one day.
  if (override) {
    const result = await runBatchForDay(dateStr, admin.id);
    return NextResponse.json({ date: dateStr, ...result });
  }

  // Otherwise sweep EVERY day that still has work the batch can actually do, not
  // just tomorrow. จัด now runs on approval, so this is the safety net: it catches
  // trips that became placeable only later — a driver came back from leave, a
  // cancellation freed a car — and anything approved while the solver was
  // failing. Idempotent, so re-running over already-assigned days is free.
  //
  // Keyed on BATCH_SOLVABLE_WHERE, the solver's own predicate. This used to ask a
  // broader question (any APPROVED booking with no driver), which included the
  // kinds the solver deliberately never touches — จองเร่งด่วน, SMUS charter, TJW,
  // an outsourced bus. Those bookings pinned their day on this list for good: the
  // sweep re-solved the day nightly, the solver skipped the booking every time,
  // and nothing could ever clear it. Every such booking permanently added a day
  // to the nightly run, so the sweep only grew. They still need a human, and the
  // per-day board is where they are shown.
  //
  // Bounded ahead as well as behind. Without an upper bound a trip approved a year
  // out put its day in EVERY nightly run from now until it happens — hundreds of
  // pointless solves a night, growing with the booking horizon. Nothing is lost:
  // the day re-enters the window as it approaches, and การจัด also runs on approval.
  const sweepHorizon = addDays(startOfDay(new Date()), CRON_SWEEP_HORIZON_DAYS);
  const outstanding = await prisma.booking.findMany({
    where: {
      ...BATCH_SOLVABLE_WHERE,
      startAt: { gte: startOfDay(new Date()), lt: sweepHorizon },
    },
    select: { startAt: true },
    orderBy: { startAt: "asc" },
  });
  const days = [...new Set(outstanding.map((b) => format(b.startAt, "yyyy-MM-dd")))];
  // Always include tomorrow, so a day with nothing outstanding is still solved
  // ahead of time exactly as before.
  if (!days.includes(dateStr)) days.push(dateStr);

  const runs = [];
  for (const day of days) {
    runs.push({ date: day, ...(await runBatchForDay(day, admin.id)) });
  }
  return NextResponse.json({ days: days.length, runs });
}
