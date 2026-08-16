import { useTranslations } from "next-intl";
import type { BookingStatus } from "@prisma/client";
import { STATUS_STYLE } from "@/lib/booking/status-style";

// Colours live in lib/booking/status-style.ts, shared with the month calendar —
// this file used to own a second copy that the calendar's own map had drifted
// from. See that file for why the key type matters.
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const t = useTranslations("status");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status].badge}`}
    >
      {t(status)}
    </span>
  );
}
