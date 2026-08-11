"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarClock, Check, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { approveBookingAction, denyByApproverAction } from "@/lib/booking/approval-actions";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";
import { DenyPresetChips } from "@/components/forms/deny-preset-chips";

// Inline approve/deny for one pending booking on the console queue, so the
// approver clears the queue without opening each detail page. Approve is one
// tap; deny expands in place (canned chips + editable reason). The server
// actions enforce the real permission (canApprove) and status guards — these
// buttons render only for approvers, and Deny only on PENDING_APPROVAL
// (denyByApproverAction rejects WAITLIST), so `canDeny` mirrors that.
export function ApproverQueueActions({
  bookingId,
  canDeny,
  returnTrip = true,
  endAt,
  startAt,
  dayFull: dayFullFromServer = false,
}: {
  bookingId: string;
  canDeny: boolean;
  /**
   * The placement engine found no car for this trip on its day (computed with
   * the queue, so it is known BEFORE anyone clicks).
   *
   * When true there is no approve button at all. Approving is not a decision
   * P'Top can make here — the fleet cannot serve the trip, and the only honest
   * moves are to go rearrange that day's board or to refuse. Once a slot is
   * freed there, the queue re-renders and อนุมัติ comes back on its own; nothing
   * has to be unlocked by hand.
   */
  dayFull?: boolean;
  // One-way ("ไม่เดินทางกลับ"): the requester's time is when they expect to
  // ARRIVE, so the car is still out afterwards. Approval confirms when it is
  // back at the faculty — pre-filled with their answer, editable here so the
  // queue can be cleared without opening every card.
  returnTrip?: boolean;
  endAt?: string;
  startAt?: string;
}) {
  const t = useTranslations("approverActions");
  const router = useRouter();
  const [denyOpen, setDenyOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmedEnd, setConfirmedEnd] = useState(endAt ?? "");
  // Optional free-text note on APPROVE. Approving needs no justification, so
  // this never gates the button — it rides along on the Approval row and shows
  // in the booking's history. Deny keeps its required reason below.
  const [approveNote, setApproveNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  // The server can still refuse a day the queue rendered as free — someone else
  // took the last car in between. Either source hides the approve button.
  const [refusedAsFull, setRefusedAsFull] = useState(false);
  const dayFull = dayFullFromServer || refusedAsFull;
  const dayHref = startAt ? `/admin/schedule?date=${startAt.slice(0, 10)}` : "/admin/schedule";
  // The override panel: approve a day with no car anyway, with a written reason.
  const [forceOpen, setForceOpen] = useState(false);
  const [forceReason, setForceReason] = useState("");

  const approve = useFormAction(approveBookingAction, {
    bookingId,
    onSuccess: () => router.refresh(),
    onResult: (res) => {
      const full = !!(res && !res.ok && (res as { dayFull?: boolean }).dayFull);
      // Latch, never clear. Clearing on a non-capacity failure (a too-short
      // override reason, say) would put the ordinary approve button back on a
      // day that is still full.
      if (full) setRefusedAsFull(true);
      // Losing the last car to someone else between render and click is a race,
      // not a mistake — take them to that day's board rather than leaving them
      // reading a refusal, exactly as the pre-rendered case does. Not while the
      // override panel is open: navigating away would discard the reason they
      // are part-way through typing.
      if (full && startAt && !forceOpen) router.push(dayHref);
    },
  });
  const deny = useFormAction(denyByApproverAction, {
    bookingId,
    onSuccess: () => {
      setDenyOpen(false);
      setReason("");
      router.refresh();
    },
  });

  if (denyOpen) {
    return (
      <div className="mt-3 space-y-2 border-t pt-3">
        <DenyPresetChips onPick={setReason} />
        <Textarea
          aria-label={t("reason")}
          placeholder={t("reason")}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <FormError message={deny.error} />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={deny.pending || reason.trim().length < 3}
            onClick={() => {
              const fd = new FormData();
              fd.set("comment", reason);
              deny.run(fd);
            }}
          >
            {deny.pending ? t("denying") : t("deny")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={deny.pending}
            onClick={() => {
              setDenyOpen(false);
              setReason("");
            }}
          >
            {t("cancel")}
          </Button>
        </div>
      </div>
    );
  }

  // No car can serve this trip on its day. The first answer is the schedule
  // board, where making room is actually possible, and the second is to refuse.
  // Approving anyway is available as a deliberate override — behind a reason,
  // and never as the default-looking button.
  if (dayFull) {
    if (forceOpen) {
      return (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">{t("forceApproveHint")}</p>
          {/* A one-way trip needs its arrival time set before ANY approve — the
              server checks that before it checks capacity, so without this the
              override would fail every time on an unrelated error. */}
          {!returnTrip && (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {t("confirmEndLabel")}
              <DateTimePicker
                name=""
                min={startAt}
                defaultValue={endAt}
                placeholder={t("confirmEndLabel")}
                timeLabel={t("confirmEndLabel")}
                onChange={setConfirmedEnd}
              />
            </span>
          )}
          <Textarea
            autoFocus
            aria-label={t("forceApproveReason")}
            placeholder={t("forceApproveReason")}
            rows={2}
            value={forceReason}
            onChange={(e) => setForceReason(e.target.value)}
          />
          <FormError message={approve.error} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={
                approve.pending || forceReason.trim().length < 3 || (!returnTrip && !confirmedEnd)
              }
              onClick={() => {
                const fd = new FormData();
                fd.set("force", "1");
                fd.set("comment", forceReason.trim());
                if (!returnTrip) fd.set("endAt", confirmedEnd);
                approve.run(fd);
              }}
            >
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {approve.pending ? t("forceApproving") : t("forceApproveConfirm")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={approve.pending}
              onClick={() => {
                setForceOpen(false);
                setForceReason("");
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-3 space-y-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">{t("dayFullHint")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {/* A link, not a button with router.push: this navigates, so it should
              middle-click and open in a new tab like any other navigation. */}
          <Link href={dayHref} className={cn(buttonVariants())}>
            <CalendarClock className="h-4 w-4" aria-hidden />
            {t("goFixSchedule")}
          </Link>
          <Button type="button" variant="destructive" onClick={() => setDenyOpen(true)}>
            <X className="h-4 w-4" />
            {t("deny")}
          </Button>
          {/* Ghost, and last: the override is available, not encouraged. Fixing
              the schedule is the thing that actually gets the trip a car. */}
          <Button type="button" variant="ghost" onClick={() => setForceOpen(true)}>
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {t("forceApprove")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
      {!returnTrip && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {t("confirmEndLabel")}
          {/* The app's picker, not the browser's — the native control renders
              its month names and Clear/Today in English. */}
          <DateTimePicker
            name=""
            min={startAt}
            defaultValue={endAt}
            placeholder={t("confirmEndLabel")}
            timeLabel={t("confirmEndLabel")}
            onChange={setConfirmedEnd}
          />
        </span>
      )}
      {/* First click on อนุมัติ opens the note box; the second confirms. The
          note is never required — leaving it empty and pressing อนุมัติ again is
          the normal path — but it is offered every time rather than hidden
          behind a separate link. */}
      {noteOpen && (
        <Textarea
          autoFocus
          rows={2}
          value={approveNote}
          onChange={(e) => setApproveNote(e.target.value)}
          placeholder={t("approveCommentLabel")}
          aria-label={t("approveCommentLabel")}
          className="w-full"
        />
      )}
      <Button
        type="button"
        disabled={approve.pending || (!returnTrip && !confirmedEnd)}
        onClick={() => {
          if (!noteOpen) {
            setNoteOpen(true);
            return;
          }
          const fd = new FormData();
          if (!returnTrip) fd.set("endAt", confirmedEnd);
          if (approveNote.trim()) fd.set("comment", approveNote.trim());
          approve.run(fd);
        }}
      >
        <Check className="h-4 w-4" />
        {approve.pending ? t("approving") : t("approve")}
      </Button>
      {noteOpen && (
        <Button
          type="button"
          variant="outline"
          disabled={approve.pending}
          onClick={() => {
            setNoteOpen(false);
            setApproveNote("");
          }}
        >
          {t("cancel")}
        </Button>
      )}
      {canDeny && (
        <Button
          type="button"
          variant="destructive"
          disabled={approve.pending}
          onClick={() => setDenyOpen(true)}
        >
          <X className="h-4 w-4" />
          {t("deny")}
        </Button>
      )}
      <FormError message={approve.error} />
    </div>
  );
}
