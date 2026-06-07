import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { ChangeUsernameForm } from "@/components/forms/change-username-form";
import { ChangePasswordForm } from "@/components/forms/change-password-form";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ forceChange?: string }>;
}) {
  const session = await requireUser();
  const t = await getTranslations("account");
  const { forceChange } = await searchParams;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      email: true,
      username: true,
      name: true,
      mustChangePassword: true,
      usernameChangedAt: true,
    },
  });

  // proxy.ts redirects mustChangePassword users here with ?forceChange=1.
  // Surface the stronger banner so they know they can't navigate away.
  const forced = forceChange === "1" || user.mustChangePassword;

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

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

      <Card className={forced ? "border-primary/40 ring-1 ring-primary/30" : ""}>
        <CardHeader>
          <CardTitle>{t("passwordTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm autoFocus={forced} />
        </CardContent>
      </Card>
    </div>
  );
}
