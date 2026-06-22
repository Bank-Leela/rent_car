import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";

export const DEV_COOKIE = "dev_user_id";
// Dev impersonation runs ONLY outside production (NODE_ENV !== "production").
// There is deliberately NO env escape hatch: getDevSession() is preferred over
// real auth, and /api/dev/sign-in sets the session from a bare user id, so a
// single flag flipped on the production host would turn it into credential-free
// impersonation of any user (incl. ADMIN). A preview that needs it must run a
// non-production build.
export const DEV_ENABLED = process.env.NODE_ENV !== "production";

export type DevSession = {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    image: string | null;
    roles: Role[];
    isActive: boolean;
    mustChangePassword: boolean;
  };
};

export async function getDevSession(): Promise<DevSession | null> {
  if (!DEV_ENABLED) return null;
  const userId = (await cookies()).get(DEV_COOKIE)?.value;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: true },
  });
  if (!user) return null;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      roles: user.roles.map((r) => r.role),
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
    },
  };
}
