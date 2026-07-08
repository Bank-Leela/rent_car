import { NextResponse } from "next/server";
import { addDays, startOfDay, format } from "date-fns";
import { prisma } from "@/lib/db";
import { getCronSecret, isValidCronAuth } from "@/lib/config/cron";
import { runBatchForDay } from "@/lib/booking/batch-core";

// Daily round-scheduling (จัดรอบ) auto-run. A systemd timer / crontab POSTs here
// each evening with `Authorization: Bearer <CRON_SECRET>`; it assigns TOMORROW's
// OT/WERN/NORMAL rounds so the board is set the night before. The manual
// /admin/batch button still works and is idempotent, so both paths coexist.
//
// Fail-closed: no secret configured → 503; wrong/absent bearer → 401.
// TZ note: "tomorrow" is computed in server-local time, which MUST be
// Asia/Bangkok in production (see docs/deployment.md) or the day is wrong.
export async function POST(req: Request) {
  if (!getCronSecret()) return new NextResponse("not configured", { status: 503 });
  if (!isValidCronAuth(req.headers.get("authorization"))) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  // Default target = tomorrow; `?date=YYYY-MM-DD` overrides for a manual re-run.
  const url = new URL(req.url);
  const override = url.searchParams.get("date");
  const dateStr = override ?? format(addDays(startOfDay(new Date()), 1), "yyyy-MM-dd");

  // The automated run is attributed to an admin in the audit log (there is no
  // interactive session). Use any active admin.
  const admin = await prisma.user.findFirst({
    where: { isActive: true, roles: { some: { role: "ADMIN" } } },
    select: { id: true },
  });
  if (!admin) return NextResponse.json({ ok: false, error: "no admin to attribute the run" }, { status: 500 });

  const result = await runBatchForDay(dateStr, admin.id);
  return NextResponse.json({ date: dateStr, ...result });
}
