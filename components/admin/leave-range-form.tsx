"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select-field";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { setDriverLeaveRangeAction } from "@/lib/booking/availability-actions";

type Driver = { driverId: string; name: string };

// Leave is planned in blocks — "the 12th to the 16th" — but the only way to
// record it was the per-day chips on whichever day you happened to be viewing,
// so a week off meant navigating to five boards and clicking five times.
//
// Each day in the range is settled independently on the server (its own เวร
// re-roster, its own hand-off), so the summary reports real per-day totals
// rather than assuming the range behaved uniformly.
export function LeaveRangeForm({ drivers, defaultFrom }: { drivers: Driver[]; defaultFrom: string }) {
  const t = useTranslations("roster");
  const router = useRouter();
  const [driverId, setDriverId] = useState(drivers[0]?.driverId ?? "");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultFrom);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setMsg(null);
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("driverId", driverId);
      fd.set("from", from);
      fd.set("to", to);
      fd.set("off", "true");
      const res = (await setDriverLeaveRangeAction(fd)) as {
        ok: boolean;
        error?: string;
        days?: number;
        handedOff?: number;
        released?: number;
        rerostered?: number;
        coDriverLost?: number;
        needsReview?: number;
      };
      if (!res.ok) {
        setError(res.error ?? null);
        return;
      }
      setMsg(
        t("rangeDone")
          .replace("%days%", String(res.days ?? 0))
          .replace("%handed%", String(res.handedOff ?? 0))
          .replace("%released%", String(res.released ?? 0))
          // Both of these keep a driver, so neither is counted in %released% —
          // reporting only that would read as a clean hand-off while a >400 km
          // trip sits short a second driver, or a trip already under way still
          // names someone who is off.
          .replace("%codriver%", String(res.coDriverLost ?? 0))
          .replace("%review%", String(res.needsReview ?? 0))
          .replace("%rerostered%", String(res.rerostered ?? 0)),
      );
      router.refresh();
    });
  };

  if (drivers.length === 0) return null;

  return (
    <div className="rounded-md border bg-muted/30 p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <CalendarOff className="h-4 w-4 text-muted-foreground" aria-hidden />
        {t("rangeTitle")}
      </h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="leave-driver" className="text-xs">{t("rangeDriver")}</Label>
          <SelectField
            id="leave-driver"
            name="driverId"
            value={driverId}
            onValueChange={setDriverId}
            className="h-11 w-52"
            options={drivers.map((d) => ({ value: d.driverId, label: d.name }))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("rangeFrom")}</Label>
          <div className="w-44">
            <DateTimePicker name="" dateOnly defaultValue={from ? `${from}T00:00` : ""} onChange={(v) => setFrom(v.slice(0, 10))} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("rangeTo")}</Label>
          <div className="w-44">
            <DateTimePicker name="" dateOnly defaultValue={to ? `${to}T00:00` : ""} onChange={(v) => setTo(v.slice(0, 10))} />
          </div>
        </div>
        <Button type="button" size="lg" disabled={pending || !driverId} onClick={submit}>
          {pending ? t("rangeSaving") : t("rangeSubmit")}
        </Button>
      </div>
      {msg && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{msg}</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
