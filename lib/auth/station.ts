// The shared driver "station" kiosk is a single, designated DRIVER account that
// the schedule board treats as able to view/record ANY trip. It MUST be
// identified by a positive allowlist — NOT by "a DRIVER with no driver profile",
// because every freshly-added (un-provisioned) driver and every multi-role
// ADMIN/APPROVER+DRIVER account is also profile-less, and must NOT gain kiosk
// powers. Configurable per deployment via DRIVER_STATION_EMAILS (comma list);
// defaults to the seeded kiosk account.
export const SHARED_STATION_EMAILS: string[] = (
  process.env.DRIVER_STATION_EMAILS ?? "driverstation@chula.ac.th"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isStationEmail(email: string | null | undefined): boolean {
  return !!email && SHARED_STATION_EMAILS.includes(email.toLowerCase());
}
