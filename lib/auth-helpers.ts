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

export function homePathFor(roles: Role[]): string {
  if (roles.includes("ADMIN")) return "/admin";
  if (roles.includes("APPROVER")) return "/approver";
  if (roles.includes("DRIVER") || roles.includes("GARAGE_COORDINATOR")) return "/driver";
  return "/requester";
}
