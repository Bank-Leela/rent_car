import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BookingStatus } from "@prisma/client";
import { STATUS_STYLE, requesterFacingStatus } from "./status-style";

// The requester's status vocabulary is three words wide on purpose (see
// requesterFacingStatus). It is a display rule with no type to enforce it, so
// the next status added to the enum lands here rather than on a requester's
// screen as a stage of the office's internal paperwork.
describe("requesterFacingStatus", () => {
  const ALL = Object.values(BookingStatus);

  // The whole point of the mapping: these three never reach a requester.
  it.each(["DRAFT", "WAITLIST", "AWAITING_DOCUMENT"] as const)(
    "%s reads as รออนุมัติ to the requester",
    (status) => {
      expect(requesterFacingStatus(status)).toBe("PENDING_APPROVAL");
    },
  );

  // The three that stay, and the outcomes.
  it.each(["PENDING_APPROVAL", "APPROVED", "ASSIGNED", "OUTSOURCED", "COMPLETED", "DENIED", "CANCELLED"] as const)(
    "%s is shown as itself",
    (status) => {
      expect(requesterFacingStatus(status)).toBe(status);
    },
  );

  it("covers every status in the enum", () => {
    // No throw, and no status maps to something the badge cannot draw.
    for (const s of ALL) expect(STATUS_STYLE[requesterFacingStatus(s)]).toBeDefined();
  });

  it("every requester-facing status has a Thai label", () => {
    const messages = JSON.parse(readFileSync("messages/th.json", "utf8")) as {
      status: Record<string, string>;
    };
    for (const s of ALL) expect(messages.status[requesterFacingStatus(s)]).toBeTruthy();
  });

  it("staff still see the raw pipeline", () => {
    // The mapping is opt-in at the badge; nothing here may start collapsing the
    // admin queue, whose AWAITING_DOCUMENT section is where จัด gets triggered.
    const badge = readFileSync("components/booking-status-badge.tsx", "utf8");
    expect(badge).toMatch(/audience = "staff"/);
    expect(badge).toMatch(/audience === "requester" \? requesterFacingStatus\(status\) : status/);
  });
});
