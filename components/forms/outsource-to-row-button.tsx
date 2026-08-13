"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { outsourceToRowAction } from "@/lib/booking/adhoc-actions";

export type OutsideTarget = { id: string; label: string };

/**
 * Put an unassigned trip onto one of the day's hired vehicles.
 *
 * The unassigned bar offered a fleet-placement button only when the solver found
 * a legal car, and everything else got เปิดคำขอ — open the request — which is not
 * an action, it is a link away. For a trip that CANNOT take a faculty car (a
 * รถบัสเช่า, an external charter, anything the requester flagged for outsourcing)
 * that left the row with nothing to do at all, sitting on the board indefinitely.
 *
 * One button per hired vehicle rather than a picker: the number of outside
 * vehicles on a day is one or two, so a list of buttons is fewer clicks than a
 * select, and it matches how the คนขับนอก panel already offers its own targets.
 */
export function OutsourceToRowButton({
  bookingId,
  targets,
}: {
  bookingId: string;
  targets: OutsideTarget[];
}) {
  const t = useTranslations("scheduler");
  const router = useRouter();
  const [pending, start] = useTransition();

  // Nothing hired yet for this day. Say so and name the control that fixes it,
  // rather than rendering an empty gap where a button should be.
  if (targets.length === 0) {
    return (
      <span className="shrink-0 text-xs text-amber-800 dark:text-amber-300">
        {t("externalWaitingNeedsRow")}
      </span>
    );
  }

  const attach = (rowId: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("bookingId", bookingId);
      fd.set("rowId", rowId);
      const res = (await outsourceToRowAction(fd)) as { ok: boolean; carriedForward?: number };
      // A recurring booking carries this vendor to its later dates, creating a row
      // on each. That happens on days the admin is not looking at, so it is said
      // out loud here exactly as it is on the board.
      if (res?.ok && (res.carriedForward ?? 0) > 0) {
        toast.success(t("externalCarriedForward", { count: res.carriedForward! }));
      }
      router.refresh();
    });

  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1.5">
      {targets.map((v) => (
        <Button
          key={v.id}
          type="button"
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => attach(v.id)}
        >
          <Truck className="h-3 w-3" aria-hidden />
          {t("externalWaitingAssign", { row: v.label })}
        </Button>
      ))}
    </span>
  );
}
