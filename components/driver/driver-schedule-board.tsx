"use client";

import { useState } from "react";
import { Car, Link2 } from "lucide-react";
import {
  type SchedulerVehicle,
  type SchedulerBooking,
  JOB_COLOR,
  JOB_LEGEND,
  jobStyle,
  carLabel,
  pctOf,
  DEFAULT_START,
  DEFAULT_END,
  LANE_PX,
  LANE_PAD,
} from "@/components/admin/scheduler-board-shared";
import { TripDetailDrawer } from "@/components/driver/trip-detail-drawer";

// Kiosk lanes run taller than the admin board's: the garage screen is read
// from a distance and tapped with fingers, so blocks get more height and
// larger type while keeping the same geometry + job-type theme.
const KIOSK_LANE_PX = Math.round(LANE_PX * 1.25);

// Read-only timeline of P'Top's official schedule for the driver side: cars as
// rows, time on the X-axis. No drag — drivers view here; P'Top assigns on the
// admin board. Reuses the admin board's geometry + job-type theme so the two
// read identically.
export function DriverScheduleBoard({
  vehicles,
  bookings,
  dutyVehicleId,
  labels,
}: {
  vehicles: SchedulerVehicle[];
  bookings: SchedulerBooking[];
  dutyVehicleId: string | null;
  labels: { duty: string; noDriver: string; coDriver: string; arrives: string; empty: string };
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const realEnds = bookings.filter((b) => b.endHour < 24).map((b) => b.endHour);
  const dayStart = Math.max(0, Math.floor(Math.min(DEFAULT_START, ...bookings.map((b) => b.startHour))));
  const dayEnd = Math.min(24, Math.ceil(Math.max(DEFAULT_END, ...realEnds)));
  const dayHours = dayEnd - dayStart;
  const hours = Array.from({ length: dayHours + 1 }, (_, i) => dayStart + i);

  const onVehicle = (vid: string) => bookings.filter((b) => b.vehicleId === vid);
  const coDriverOn = (vid: string) =>
    bookings.filter((b) => !!b.secondaryDriverName && b.secondaryVehicleId === vid);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {JOB_LEGEND.map((jt) => (
          <span key={jt} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${JOB_COLOR[jt]!.dot}`} aria-hidden />
            {JOB_COLOR[jt]!.label}
          </span>
        ))}
      </div>

      {vehicles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <div className="min-w-[64rem]">
            <div className="flex border-b bg-muted/30">
              <div className="w-44 shrink-0 border-r" />
              <div className="relative h-9 flex-1">
                {hours.map((h) => (
                  <span
                    key={h}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground"
                    style={{ left: `${pctOf(h, dayStart, dayHours)}%` }}
                  >
                    {String(h).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
            </div>

            {vehicles.map((v, i) => (
              <Row
                key={v.id}
                vehicle={v}
                label={carLabel(i)}
                isDuty={v.id === dutyVehicleId}
                bookings={onVehicle(v.id)}
                coDrivers={coDriverOn(v.id)}
                dayStart={dayStart}
                dayHours={dayHours}
                hours={hours}
                labels={labels}
                onOpen={setOpenId}
              />
            ))}
          </div>
        </div>
      )}

      <TripDetailDrawer bookingId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Row({
  vehicle,
  label,
  isDuty,
  bookings,
  coDrivers,
  dayStart,
  dayHours,
  hours,
  labels,
  onOpen,
}: {
  vehicle: SchedulerVehicle;
  label: string;
  isDuty: boolean;
  bookings: SchedulerBooking[];
  coDrivers: SchedulerBooking[];
  dayStart: number;
  dayHours: number;
  hours: number[];
  labels: { duty: string; noDriver: string; coDriver: string; arrives: string; empty: string };
  onOpen: (bookingId: string) => void;
}) {
  type Item = { key: string; b: SchedulerBooking; kind: "primary" | "co"; startHour: number; endHour: number };
  const items: Item[] = [
    ...bookings.map((b) => ({ key: b.id, b, kind: "primary" as const, startHour: b.startHour, endHour: b.endHour })),
    ...coDrivers.map((b) => ({ key: `co-${b.id}`, b, kind: "co" as const, startHour: b.startHour, endHour: b.endHour })),
  ];
  const sorted = [...items].sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const it of sorted) {
    let lane = laneEnds.findIndex((end) => end <= it.startHour);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.endHour);
    } else laneEnds[lane] = it.endHour;
    laneOf.set(it.key, lane);
  }
  const laneCount = Math.max(1, laneEnds.length);

  return (
    <div className="flex border-b last:border-b-0">
      <div className="flex w-44 shrink-0 items-center gap-2 border-r px-3 py-2 text-sm font-medium">
        <Car className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0">{label}</span>
        {vehicle.driverName ? (
          <span className="truncate text-xs font-normal text-muted-foreground">· {vehicle.driverName}</span>
        ) : (
          <span className="truncate text-[10px] font-normal text-destructive">· {labels.noDriver}</span>
        )}
        {isDuty && (
          <span className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {labels.duty}
          </span>
        )}
      </div>
      <div className="relative flex-1" style={{ height: laneCount * KIOSK_LANE_PX }}>
        {hours.map((h) => (
          <div
            key={h}
            aria-hidden
            className="absolute inset-y-0 w-px bg-border/40"
            style={{ left: `${pctOf(h, dayStart, dayHours)}%` }}
          />
        ))}
        {items.map((it) => {
          const top = (laneOf.get(it.key) ?? 0) * KIOSK_LANE_PX + LANE_PAD;
          const height = KIOSK_LANE_PX - 2 * LANE_PAD;
          const left = pctOf(it.b.startHour, dayStart, dayHours);
          const width = Math.max(pctOf(it.b.endHour, dayStart, dayHours) - left, 1.2);
          const multiDay = it.b.continuesBefore || it.b.continuesAfter;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onOpen(it.b.id)}
              title={`${it.b.jobNumber} · ${it.b.timeLabel} · ${it.b.purpose} → ${it.b.destination}`}
              className={`absolute block cursor-pointer overflow-hidden rounded-md border px-2 py-1 text-left text-xs transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:brightness-110 ${
                it.kind === "co"
                  ? "border-dashed border-violet-400/70 bg-violet-50 text-violet-900 dark:bg-violet-950/30 dark:text-violet-200"
                  : `${jobStyle(it.b.jobType).block} ${it.b.secondaryDriverName ? "ring-1 ring-violet-400/70" : ""}`
              } ${it.b.continuesBefore ? "rounded-l-none border-l-4" : ""} ${
                it.b.continuesAfter ? "rounded-r-none border-r-4" : ""
              }`}
              style={{ left: `${left}%`, width: `${width}%`, top, height }}
            >
              <div className="flex items-center gap-1 font-medium">
                {it.kind === "co" && <Link2 className="h-3 w-3 shrink-0" aria-hidden />}
                {multiDay ? (
                  <>
                    <span className="min-w-0 truncate">{it.b.departLabel}</span>
                    <span className="ml-auto shrink-0 truncate pl-1">
                      {labels.arrives} {it.b.arriveLabel}
                    </span>
                  </>
                ) : (
                  <span className="min-w-0 truncate">
                    {it.b.timeLabel}–{it.b.endLabel}
                  </span>
                )}
              </div>
              {it.kind === "co" ? (
                <div className="truncate text-[11px] font-medium">{labels.coDriver}</div>
              ) : (
                <div className="truncate text-muted-foreground">{it.b.purpose}</div>
              )}
              {it.kind === "primary" && it.b.driverName && (
                <div className="truncate text-[11px] font-medium text-primary">{it.b.driverName}</div>
              )}
              {it.kind === "co" && it.b.driverName && (
                <div className="truncate text-[11px] text-violet-700 dark:text-violet-300">→ {it.b.driverName}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
