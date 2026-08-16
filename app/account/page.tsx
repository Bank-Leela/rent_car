import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { KeyRound } from "lucide-react";
import { requireUser, homePathFor } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { UrgentNote } from "@/components/urgent-note";
import { AccountSectionNav } from "@/components/account/account-section-nav";
import { AccountSection } from "@/components/account/account-section";
import { ChangeUsernameForm } from "@/components/forms/change-username-form";
import { ChangePasswordForm } from "@/components/forms/change-password-form";
import { ChangeDepartmentForm } from "@/components/forms/change-department-form";
import { accountSections } from "@/lib/account/sections";
import { listDepartments } from "@/lib/departments";
import { DEV_COOKIE, DEV_ENABLED } from "@/lib/dev-auth";
import { signOutAction } from "@/lib/auth/credentials-actions";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ forceChange?: string }>;
}) {
  const session = await requireUser();
  const t = await getTranslations("account");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const homePath = homePathFor(session.user.roles);
  const { forceChange } = await searchParams;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      email: true,
      username: true,
      mustChangePassword: true,
      usernameChangedAt: true,
      departmentId: true,
    },
  });
  const departments = await listDepartments(locale);
  const sections = await accountSections();

  // proxy.ts redirects mustChangePassword users here with ?forceChange=1.
  // Surface the stronger banner so they know they can't navigate away.
  const forced = forceChange === "1" || user.mustChangePassword;
  // Mirrors the layout's nav lock, and it is narrower than `forced` on purpose:
  // dev-cookie sessions are exempt from proxy.ts's redirect (proxy.ts:36-37), so
  // for them the bar stays live and "back" is the honest action. The banner
  // still follows `forced` — telling someone their password is temporary is
  // right either way; only the escape hatch follows what the server enforces.
  const isDevImpersonation = DEV_ENABLED && !!(await cookies()).get(DEV_COOKIE);
  const navLocked = user.mustChangePassword && !isDevImpersonation;

  return (
    // max-w-5xl, was 3xl: the rail needs a column of its own beside the content,
    // and at 3xl the two together squeezed the inputs narrower than they were.
    // mx-auto matters — AppShell centres <main> at max-w-7xl, so a bare column
    // sat hard against the left and left ~690px of dead space on a wide screen.
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          // Follows the nav lock, not the banner: sign-out is offered instead of
          // "back" because under a real lock there is nowhere to go back TO. Once
          // the bar is live again, "back" is the honest action — offering only
          // sign-out beside a working nav made leaving look harder than it is.
          navLocked ? (
            <form
              action={isDevImpersonation ? "/api/dev/sign-out" : signOutAction}
              method={isDevImpersonation ? "post" : undefined}
            >
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
              >
                {tc("signOut")}
              </button>
            </form>
          ) : (
            <Link
              href={homePath}
              className="inline-flex h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
            >
              {tc("back")}
            </Link>
          )
        }
      />

      {/* UrgentNote, not a sixth hand-rolled amber block. This one predates the
          component and kept its own border-amber-300/bg-amber-50 pair with a
          hand-synced dark: override — the exact thing the --urgent tokens were
          added to end. */}
      {forced && (
        <UrgentNote icon={KeyRound} title={t("mustChangeBanner")}>
          <p className="mt-1 text-xs opacity-90">{t("mustChangeBlocked")}</p>
        </UrgentNote>
      )}

      <div className="grid gap-6 lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start">
        <AccountSectionNav sections={sections} label={t("title")} />

        {/* One card, sections divided by hairlines — rather than one card per
            setting with a 24px gutter between each. Settings are one object.
            gap-0/py-0 because Card's own padding would double up on theirs. */}
        <Card className="gap-0 py-0">
          <div className="divide-y">
            <AccountSection id="email" title={t("emailTitle")} description={t("emailNote")}>
              <p className="font-mono text-sm break-all">{user.email}</p>
            </AccountSection>

            <AccountSection id="username" title={t("usernameTitle")}>
              <ChangeUsernameForm
                currentUsername={user.username ?? ""}
                alreadyChanged={!!user.usernameChangedAt}
              />
            </AccountSection>

            <AccountSection id="department" title={t("departmentTitle")}>
              <ChangeDepartmentForm
                departments={departments}
                currentDepartmentId={user.departmentId}
              />
            </AccountSection>

            <AccountSection id="password" title={t("passwordTitle")} highlight={forced}>
              <ChangePasswordForm autoFocus={forced} />
            </AccountSection>
          </div>
        </Card>
      </div>
    </div>
  );
}
