import { useTranslations } from "next-intl";
import type { BookingStatus } from "@prisma/client";
import { STATUS_STYLE, requesterFacingStatus } from "@/lib/booking/status-style";

// Colours live in lib/booking/status-style.ts, shared with the month calendar —
// this file used to own a second copy that the calendar's own map had drifted
// from. See that file for why the key type matters.
export function BookingStatusBadge({
  status,
  /**
   * Who is reading. The requester sees a shorter vocabulary than staff — see
   * requesterFacingStatus for which stages collapse and why. Defaults to the raw
   * status so every staff surface keeps the full set without opting in.
   */
  audience = "staff",
}: {
  status: BookingStatus;
  audience?: "staff" | "requester";
}) {
  const t = useTranslations("status");
  const shown = audience === "requester" ? requesterFacingStatus(status) : status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[shown].badge}`}
    >
      {t(shown)}
    </span>
  );
}
