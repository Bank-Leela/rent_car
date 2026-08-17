import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getSession } from "@/lib/session";

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) redirect("/");
  // A user deactivated mid-session keeps a live JWT until expiry; the token
  // refreshes isActive from the DB each request (auth.ts), so enforce it at the
  // single choke point every RSC/server action funnels through. "/" is public and
  // holds the sign-in form. `=== false` (not `!isActive`): prod always sets a
  // concrete boolean (auth.ts `?? false`), so this blocks deactivated users
  // identically while matching proxy.ts.
  if (session.user.isActive === false) redirect("/");
  return session;
}

export async function requireRole(role: Role) {
  const session = await requireUser();
  if (!session.user.roles.includes(role)) redirect("/");
  return session;
}

export async function requireAnyRole(roles: Role[]) {
  const session = await requireUser();
  if (!roles.some((r) => session.user.roles.includes(r))) redirect("/");
  return session;
}

export function homePathFor(roles: Role[]): string {
  if (roles.includes("ADMIN")) return "/admin";
  // Drivers sign in only via the shared station kiosk — land on the all-trips board.
  if (roles.includes("DRIVER")) return "/driver/schedule";
  // Requesters land on the booking form (the primary action), not the list.
  return "/requester/new";
}
