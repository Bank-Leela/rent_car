"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, Fuel, Gauge, MapPin, Receipt, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { StartTripForm, EndTripForm } from "@/components/forms/trip-forms";
import {
  getStationTripDetailAction,
  type StationTripDetail,
} from "@/lib/booking/station-actions";

// Slide-over drawer the schedule board opens when a trip block is clicked. Shows
// the trip's details and — for the shared station / assigned driver — the
// start/end + fuel/toll/mileage recording flow. The body is keyed by bookingId
// so each open is a fresh fetch; it refetches after each action so the drawer
// advances (start → end → recorded) without closing.
export function TripDetailDrawer({
  bookingId,
  onClose,
}: {
  bookingId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("stationDrawer");
  return (
    <Dialog open={bookingId != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="left-auto right-0 top-0 flex h-dvh max-h-dvh w-full max-w-md translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-none rounded-l-xl border-l p-0 sm:max-w-md"
        showCloseButton
      >
        {/* Stable accessible name for the dialog (base-ui wires aria-labelledby). */}
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        {bookingId && <DrawerBody key={bookingId} bookingId={bookingId} />}
      </DialogContent>
    </Dialog>
  );
}

function DrawerBody({ bookingId }: { bookingId: string }) {
  const t = useTranslations("stationDrawer");
  const tjt = useTranslations("jobType");
  const router = useRouter();
  const [detail, setDetail] = useState<StationTripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fresh mount per bookingId (keyed), so initial state IS the loading state and
  // the effect only sets state after the await — no synchronous reset needed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getStationTripDetailAction(bookingId);
      if (cancelled) return;
      if (res.ok) setDetail(res.detail);
      else setError(res.error);
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  async function afterRecord() {
    const res = await getStationTripDetailAction(bookingId);
    if (res.ok) setDetail(res.detail);
    router.refresh();
  }

  if (error) {
    return (
      <div className="p-5 text-sm text-destructive" role="alert">
        {t(`error_${error}`)}
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const tripDone = !!detail.trip?.endedLabel;
  const tripStarted = !!detail.trip && !tripDone;
  const canStart = detail.canRecord && detail.status === "ASSIGNED" && !detail.trip;

  return (
    <>
      <header className="border-b p-5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{detail.jobNumber}</span>
          <BookingStatusBadge status={detail.status} />
          <span className="text-[11px] text-muted-foreground">{tjt(detail.jobType)}</span>
        </div>
        <h2 className="mt-1 pr-8 text-lg font-semibold leading-tight">{detail.purpose}</h2>
      </header>

      <div className="space-y-4 p-5">
        <dl className="grid grid-cols-1 gap-3 text-sm">
          <Field icon={<MapPin className="h-4 w-4" />} label={t("destination")} value={`${detail.destination}, ${detail.province}`} />
          <Field label={t("start")} value={detail.startLabel} />
          <Field label={t("end")} value={detail.endLabel} />
          {detail.estimatedDistance != null && (
            <Field icon={<Gauge className="h-4 w-4" />} label={t("distance")} value={`${detail.estimatedDistance} km`} />
          )}
          {detail.departmentName && <Field label={t("department")} value={detail.departmentName} />}
          {detail.requesterName && <Field label={t("requester")} value={detail.requesterName} />}
          <Field icon={<Car className="h-4 w-4" />} label={t("car")} value={detail.registrationNumber ?? "—"} />
          <Field
            icon={<UserRound className="h-4 w-4" />}
            label={t("driver")}
            value={
              (detail.primaryDriverName ?? "—") +
              (detail.secondaryDriverName ? ` · +${detail.secondaryDriverName}` : "")
            }
          />
        </dl>

        {tripDone && detail.trip && (
          <section className="rounded-lg border bg-muted/30 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Receipt className="h-4 w-4" aria-hidden /> {t("recordedTrip")}
            </h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Field label={t("startMileage")} value={`${detail.trip.startMileage}`} />
              <Field label={t("endMileage")} value={`${detail.trip.endMileage ?? "—"}`} />
              <Field label={t("tripDistance")} value={detail.trip.distanceKm != null ? `${detail.trip.distanceKm} km` : "—"} />
              <Field icon={<Fuel className="h-4 w-4" />} label={t("fuel")} value={detail.trip.fuelCost != null ? `฿${detail.trip.fuelCost.toFixed(2)}` : "—"} />
              <Field label={t("fuelLiters")} value={detail.trip.fuelLiters != null ? `${detail.trip.fuelLiters.toFixed(2)} L` : "—"} />
              {detail.trip.fuelType && <Field label={t("fuelType")} value={detail.trip.fuelType} />}
              <Field label={t("toll")} value={detail.trip.tollwayCost != null ? `฿${detail.trip.tollwayCost.toFixed(2)}` : "—"} />
              {detail.trip.parkingCost != null && <Field label={t("parking")} value={`฿${detail.trip.parkingCost.toFixed(2)}`} />}
              <Field label={t("expressway")} value={detail.trip.usedExpressway ? t("yes") : t("no")} />
              {detail.trip.overtimeMin > 0 && (
                <Field label={t("overtime")} value={t("overtimeValue", { min: detail.trip.overtimeMin })} />
              )}
            </dl>
            {detail.trip.driverNotes && <p className="mt-2 text-sm text-muted-foreground">{detail.trip.driverNotes}</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              {detail.trip.startedLabel} → {detail.trip.endedLabel}
            </p>
          </section>
        )}

        {canStart && (
          <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="mb-3 text-sm font-semibold">{t("startTitle")}</h3>
            <StartTripForm bookingId={detail.id} onSuccess={afterRecord} />
          </section>
        )}
        {tripStarted && detail.canRecord && (
          <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="mb-3 text-sm font-semibold">{t("endTitle")}</h3>
            <EndTripForm bookingId={detail.id} startMileage={detail.trip?.startMileage ?? null} onSuccess={afterRecord} />
          </section>
        )}
        {tripStarted && !detail.canRecord && <p className="text-sm text-muted-foreground">{t("inProgress")}</p>}
        {!tripDone && !canStart && !tripStarted && (
          <p className="text-sm text-muted-foreground">{detail.canRecord ? t("noAction") : t("viewOnly")}</p>
        )}
      </div>
    </>
  );
}

function Field({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
