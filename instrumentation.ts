// Next.js runs register() once when the server starts. We use it to fail loud
// on the one deployment mistake that silently corrupts scheduling: the wrong
// timezone. runBatchAction (จัดรอบ) and trip-legs compute day boundaries in
// server-local time, so a default-UTC host assigns the wrong day and splits
// no-wait legs at the wrong hour. This can't auto-fix TZ (it must be set in the
// environment before Node starts) — it just makes the misconfig obvious.
const EXPECTED_TZ = "Asia/Bangkok";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  let runtimeTz = "";
  try {
    runtimeTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  if (runtimeTz !== EXPECTED_TZ) {
    const detail =
      `Server timezone is "${runtimeTz || "unknown"}" (TZ env="${process.env.TZ ?? "unset"}"), ` +
      `but scheduling requires TZ=${EXPECTED_TZ}. Day boundaries (จัดรอบ) and no-wait leg-2 splits ` +
      `disagree between the app (process-local time in trip-legs.ts) and the DB occupancy constraint ` +
      `(hardcoded ${EXPECTED_TZ} in booking_leg2_start), producing false conflicts or missed double-books. ` +
      `Set TZ=${EXPECTED_TZ} in the process environment (systemd Environment=, Docker -e, or the shell) and restart. See docs/deployment.md.`;
    // Fail loud in production — a wrong TZ silently corrupts scheduling, so refuse
    // to start rather than serve wrong assignments. In dev, warn so a non-Bangkok
    // laptop can still run (its scheduling output just won't match prod).
    if (process.env.NODE_ENV === "production") {
      throw new Error(`[TZ FATAL] ${detail}`);
    }
    console.warn(`\n[TZ WARNING] ${detail}\n`);
  }
}
