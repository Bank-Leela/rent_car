import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getSession } from "@/lib/session";

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
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
  // Approver shares the admin console; they only differ in which forms appear.
  if (roles.includes("APPROVER")) return "/admin";
  if (roles.includes("DRIVER")) return "/driver";
  return "/requester";
}
