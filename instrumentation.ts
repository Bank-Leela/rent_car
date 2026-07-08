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
    console.warn(
      `\n[TZ WARNING] Server timezone is "${runtimeTz || "unknown"}" (TZ env="${process.env.TZ ?? "unset"}").\n` +
        `  Scheduling (จัดรอบ / trip-legs) needs TZ=${EXPECTED_TZ}. Day boundaries and no-wait\n` +
        `  leg splits will be WRONG until you set TZ=${EXPECTED_TZ} in the process environment\n` +
        `  (systemd Environment=, Docker -e, or the shell) and restart. See docs/deployment.md.\n`,
    );
  }
}
