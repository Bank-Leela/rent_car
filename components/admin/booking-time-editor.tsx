"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setBookingTimeAction } from "@/lib/booking/schedule-actions";

// Time-only editor for a dispatched trip, for every job type — เวร used to be
// the only one the server would accept, which meant a late car or a moved
// meeting had to be fixed in the database.
//
// A modal, not an inline popover: the control's home is a timeline block, and a
// block is an `overflow-hidden` absolutely-positioned strip ~40px wide at this
// zoom — anything opening inside it is clipped. The modal also has room to state
// the date, which is what stops "change the time" being read as "move the trip".
export function BookingTimeEditor({
  bookingId,
  dateLabel,
  startHHmm,
  endHHmm,
  trigger = "icon",
  className,
}: {
  bookingId: string;
  /** The trip's day, shown read-only — this editor never moves a trip's date. */
  dateLabel: string;
  startHHmm: string;
  endHHmm: string;
  /** "icon" for a compact control on a block/card; "button" for a roomier surface. */
  trigger?: "icon" | "button";
  /** Positioning for the icon trigger — a timeline block hover-reveals it in its
   *  corner, a queue card just sits it in the header row. */
  className?: string;
}) {
  const t = useTranslations("scheduler");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(startHHmm);
  const [to, setTo] = useState(endHHmm);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const openEditor = () => {
    // Re-seed from props: the row may have been re-timed (by this admin or
    // another) since the last time this control was opened.
    setFrom(startHHmm);
    setTo(endHHmm);
    setError(null);
    setConflict(null);
    setOpen(true);
  };

  const save = () =>
    start(async () => {
      setError(null);
      setConflict(null);
      const fd = new FormData();
      fd.set("bookingId", bookingId);
      fd.set("startHHmm", from);
      fd.set("endHHmm", to);
      const res = await setBookingTimeAction(fd);
      if (!res.ok) {
        setError(res.error);
        if (res.conflicts?.length) {
          setConflict(
            res.conflicts
              .map((c) => `${c.destination} ${hhmm(c.startAt)}–${hhmm(c.endAt)}`)
              .join(", "),
          );
        }
        return;
      }
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      {trigger === "icon" ? (
        <button
          type="button"
          title={t("editTime")}
          aria-label={t("editTime")}
          // The block is a drag handle: a pointerdown that reaches it starts a
          // drag, so this button has to swallow the event to be pressable at all.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openEditor();
          }}
          className={`z-10 grid h-4 w-4 place-items-center rounded-sm bg-background/70 text-muted-foreground transition-opacity hover:bg-background hover:text-foreground ${
            className ?? ""
          }`}
        >
          <Clock className="h-3 w-3" aria-hidden />
        </button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={openEditor}>
          <Clock aria-hidden />
          {t("editTime")}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editTime")}</DialogTitle>
            {/* The date is shown, not offered: moving a trip to another day is a
                booking change, not a dispatch one. */}
            <DialogDescription>{t("editTimeDateFixed", { date: dateLabel })}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs font-medium">
              {t("wernFrom")}
              <input
                type="time"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-10 w-32 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              {t("wernTo")}
              <input
                type="time"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-10 w-32 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t(errorKey(error))}
              {conflict ? ` — ${conflict}` : ""}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t("editTimeCancel")}
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? t("editTimeSaving") : t("wernSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Server error codes → scheduler message keys. Anything unmapped falls back to
// the generic failure rather than printing a bare code at the dispatcher.
function errorKey(code: string): string {
  switch (code) {
    case "vehicleBusy":
      return "dropConflict";
    case "endBeforeStart":
      return "timeEndBeforeStart";
    case "tripAlreadyStarted":
      return "timeTripStarted";
    case "cannotEditTimeInStatus":
      return "timeBadStatus";
    case "timeBreaksLegs":
      return "timeBreaksLegs";
    default:
      return "dropFailed";
  }
}

const hhmm = (d: Date | string) => {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
};
