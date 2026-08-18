# Plans — historical, not instructions

Every file in this directory is a **record of what was planned**, dated in its
filename. All of them have shipped. None of them is a task list to pick up.

They are kept because the reasoning behind a decision is often the only place a
constraint is written down. Read one to understand *why* something is the way it
is — never to find out what to build next. For that, `HANDOFF.md` has the open
items and `AGENTS.md` has the rules.

**They will contradict the code, and the code wins.** Known examples:

- `2026-06-24-booking-input-classification.md` builds on `Booking.outsideChula`
  and adds English (`en`) message keys. The column was inverted to
  `travelWithinChula` on 2026-07-17 and the English locale was removed on
  2026-08-05 — following that plan today would target a column and a locale that
  no longer exist.
- Several plans open with "REQUIRED SUB-SKILL: … implement this plan
  task-by-task". That instruction was true on the day it was written and is not
  true now.

If you need the chronological record of how the project got here, that is
[`docs/session-log.md`](../../session-log.md).
