import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { requireUser, homePathFor } from "@/lib/auth-helpers";
import { isStationEmail } from "@/lib/auth/station";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ChangeUsernameForm } from "@/components/forms/change-username-form";
import { ChangePasswordForm } from "@/components/forms/change-password-form";
import { ChangeDepartmentForm } from "@/components/forms/change-department-form";
import { SignatureForm } from "@/components/forms/signature-form";
import { listDepartments } from "@/lib/departments";
import { navForRoles } from "@/lib/nav/role-nav";
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
  const tAll = await getTranslations();
  const locale = await getLocale();
  const homePath = homePathFor(session.user.roles);
  const { forceChange } = await searchParams;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      email: true,
      username: true,
      name: true,
      mustChangePassword: true,
      usernameChangedAt: true,
      departmentId: true,
      signatureName: true,
      signatureImageUrl: true,
    },
  });
  const departments = await listDepartments(locale);
  const ts = await getTranslations("signatureForm");

  // proxy.ts redirects mustChangePassword users here with ?forceChange=1.
  // Surface the stronger banner so they know they can't navigate away.
  const forced = forceChange === "1" || user.mustChangePassword;
  // This page sits outside the (requester)/(driver)/(admin) route groups, so it
  // gets no AppShell of its own — it borrows the one for the user's role below,
  // which is also the way back to the rest of the app. While the user is LOCKED
  // (temp password) the bar still renders, but inert: proxy.ts bounces every
  // other route back here, so live links would ping-pong. Sign-out stays the one
  // escape that does not defeat the lock.
  const isDevImpersonation = DEV_ENABLED && !!(await cookies()).get(DEV_COOKIE);
  const { badgeRole, routes } = navForRoles(session.user.roles, {
    isStation: isStationEmail(session.user.email),
  });

  const body = (
    // mx-auto, and it matters: AppShell centres <main> at max-w-7xl, so a bare
    // max-w-2xl column sat hard against the left of a 1280 px shell and left
    // ~690 px of dead space on a wide screen — it read as broken alignment
    // rather than as a narrow form. Every other page fills the shell; this is
    // the only page with a width of its own, so it has to centre itself.
    // 3xl over 2xl so the centred column is not a thin ribbon at 1512 px wide,
    // while staying narrow enough that the inputs are not absurdly long.
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          forced ? (
            <form action={isDevImpersonation ? "/api/dev/sign-out" : signOutAction} method={isDevImpersonation ? "post" : undefined}>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
              >
                {tc("signOut")}
              </button>
            </form>
          ) : (
            <Link
              href={homePath}
              className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              {tc("back")}
            </Link>
          )
        }
      />

      {forced && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">{t("mustChangeBanner")}</p>
          <p className="mt-1 text-xs opacity-80">{t("mustChangeBlocked")}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("emailTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="text-sm font-mono">{user.email}</div>
          <p className="text-xs text-muted-foreground">{t("emailNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("usernameTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangeUsernameForm
            currentUsername={user.username ?? ""}
            alreadyChanged={!!user.usernameChangedAt}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("departmentTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangeDepartmentForm
            departments={departments}
            currentDepartmentId={user.departmentId}
          />
        </CardContent>
      </Card>

      {/* id: the profile menu's ลายเซ็น item links straight here. */}
      <Card id="signature" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>{ts("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">{ts("description")}</p>
          <SignatureForm
            userId={session.user.id}
            signatureName={user.signatureName}
            hasSignature={!!user.signatureImageUrl}
          />
        </CardContent>
      </Card>

      <Card id="password" className={`scroll-mt-20 ${forced ? "border-primary/40 ring-1 ring-primary/30" : ""}`}>
        <CardHeader>
          <CardTitle>{t("passwordTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm autoFocus={forced} />
        </CardContent>
      </Card>
    </div>
  );

  return (
    <AppShell
      badgeRole={badgeRole}
      user={session.user}
      nav={routes.map((r) => ({ href: r.href, label: tAll(r.labelKey) }))}
      navDisabled={forced}
      // Same sentence the banner shows, repeated where the click fails: the
      // banner is below the header, so someone who reaches for the nav first
      // hits a dead link with no reason given.
      navDisabledReason={forced ? t("mustChangeBlocked") : undefined}
    >
      {body}
    </AppShell>
  );
}
