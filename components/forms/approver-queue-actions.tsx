"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
}: {
  bookingId: string;
  canDeny: boolean;
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
  // Set when approve is refused because no car can serve the day. The fleet
  // being full is the one refusal the approver has to ACT on, so Deny appears
  // here rather than making them open the detail page to find it.
  const [dayFull, setDayFull] = useState(false);

  const approve = useFormAction(approveBookingAction, {
    bookingId,
    onSuccess: () => router.refresh(),
    onResult: (res) => {
      const full = !!(res && !res.ok && (res as { dayFull?: boolean }).dayFull);
      setDayFull(full);
      // The fleet cannot serve this day as it stands. Rather than leave the
      // approver reading a refusal, take them to that day's board: rearranging
      // what is already there is the thing most likely to make room, and it is
      // two clicks away otherwise. Deny stays available on the card when they
      // come back and it genuinely will not fit.
      if (full && startAt) router.push(`/admin/schedule?date=${startAt.slice(0, 10)}`);
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
      {(canDeny || dayFull) && (
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
