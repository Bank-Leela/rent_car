import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth-helpers";
import { isStationEmail } from "@/lib/auth/station";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { navForRoles } from "@/lib/nav/role-nav";
import { DEV_COOKIE, DEV_ENABLED } from "@/lib/dev-auth";

/**
 * The shell for the account area.
 *
 * /account sits outside the (requester)/(driver)/(admin) route groups, so it has
 * no shell of its own — it borrows the one for the user's role, which is also
 * the way back to the rest of the app. That wiring used to live inside
 * app/account/page.tsx, which was fine while /account was the only page here.
 * ลายเซ็น now has its own route, and a second copy of the shell is exactly how
 * two pages in one area drift apart, so it moved up here.
 *
 * While the user is LOCKED (temporary password) the bar still renders, but
 * inert: proxy.ts bounces every other route back to /account, so live links
 * would ping-pong. Sign-out stays the one escape that does not defeat the lock,
 * and it lives on the page rather than in here.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const t = await getTranslations("account");
  const tAll = await getTranslations();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { mustChangePassword: true },
  });

  // The nav lock tracks what proxy.ts ACTUALLY enforces, which is narrower than
  // the banner's condition in two ways that both left the bar dead for no
  // reason:
  //
  //  * `?forceChange=1` is only the label proxy.ts puts on its own redirect
  //    (proxy.ts:41) — it carries no authority. A stale link, a back button, or
  //    a reload after the password was changed all keep the param, and the bar
  //    stayed inert for someone the server would happily let navigate.
  //  * dev-cookie sessions are exempt from the redirect outright
  //    (proxy.ts:36-37), yet this read mustChangePassword straight from the row
  //    — so impersonating a seeded user whose flag is set locked the bar while
  //    every route was in fact reachable.
  const isDevImpersonation = DEV_ENABLED && !!(await cookies()).get(DEV_COOKIE);
  const navLocked = user.mustChangePassword && !isDevImpersonation;
  const { badgeRole, routes } = navForRoles(session.user.roles, {
    isStation: isStationEmail(session.user.email),
  });

  return (
    <AppShell
      badgeRole={badgeRole}
      user={session.user}
      nav={routes.map((r) => ({ href: r.href, label: tAll(r.labelKey) }))}
      navDisabled={navLocked}
      // Same sentence the banner shows, repeated where the click fails: the
      // banner is below the header, so someone who reaches for the nav first
      // hits a dead link with no reason given.
      navDisabledReason={navLocked ? t("mustChangeBlocked") : undefined}
    >
      {children}
    </AppShell>
  );
}
