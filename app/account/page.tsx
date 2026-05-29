import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { ChangeUsernameForm } from "@/components/forms/change-username-form";
import { ChangePasswordForm } from "@/components/forms/change-password-form";

export default async function AccountPage() {
  const session = await requireUser();
  const t = await getTranslations("account");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { email: true, username: true, name: true, mustChangePassword: true },
  });

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {user.mustChangePassword && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          {t("mustChangeBanner")}
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
          <ChangeUsernameForm currentUsername={user.username ?? ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("passwordTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
