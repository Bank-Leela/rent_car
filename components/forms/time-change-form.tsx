"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateBookingTimeAction } from "@/lib/booking/actions";
import { WORK_START_HOUR, WORK_END_HOUR, isWithinWorkHours } from "@/lib/booking/rules";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";

const datetimeLocalValue = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

export function TimeChangeForm({
  bookingId,
  startAt,
  endAt,
  outOfHoursReason,
}: {
  bookingId: string;
  startAt: Date;
  endAt: Date;
  outOfHoursReason: string | null;
}) {
  const t = useTranslations("timeChangeForm");
  // bookingId travels via the hidden input below, so the hook doesn't stamp it.
  const { error, pending, run } = useFormAction(updateBookingTimeAction);
  const [start, setStart] = useState<string>(datetimeLocalValue(startAt));
  const [end, setEnd] = useState<string>(datetimeLocalValue(endAt));

  // Compute hours warning live so the reason field appears as the user types.
  let outOfHours = false;
  try {
    const s = new Date(start);
    const e = new Date(end);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      outOfHours = !isWithinWorkHours({ startAt: s, endAt: e });
    }
  } catch {
    /* ignore */
  }

  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <p className="text-xs text-muted-foreground">
        {t("workHoursNotice", { from: `${String(WORK_START_HOUR).padStart(2, "0")}:00`, to: `${String(WORK_END_HOUR).padStart(2, "0")}:00` })}
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="time-change-startAt">{t("startLabel")}</Label>
          <Input
            id="time-change-startAt"
            name="startAt"
            type="datetime-local"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="time-change-endAt">{t("endLabel")}</Label>
          <Input
            id="time-change-endAt"
            name="endAt"
            type="datetime-local"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      {outOfHours && (
        <div className="grid gap-2">
          <Label htmlFor="time-change-reason">{t("reasonLabel")}</Label>
          <p className="text-xs text-amber-700 dark:text-amber-400">{t("reasonWarning")}</p>
          <Textarea
            id="time-change-reason"
            name="outOfHoursReason"
            rows={3}
            required={outOfHours}
            defaultValue={outOfHoursReason ?? ""}
            placeholder={t("reasonPlaceholder")}
          />
        </div>
      )}

      <FormError message={error} />

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
