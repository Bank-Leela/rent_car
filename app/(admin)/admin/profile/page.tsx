import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignatureForm, DelegateForm } from "@/components/forms/signature-form";

export default async function ApproverProfile() {
  const session = await requireRole("ADMIN");
  const t = await getTranslations("profile");
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      signatureImageUrl: true,
      delegatedTo: { select: { email: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("storedSignatureTitle")}</CardTitle>
          <CardDescription>
            {me.signatureImageUrl ? t("signatureOnFile") : t("signatureNoFile")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignatureForm hasSignature={!!me.signatureImageUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("delegationTitle")}</CardTitle>
          <CardDescription>{t("delegationDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DelegateForm currentDelegateEmail={me.delegatedTo?.email ?? null} />
        </CardContent>
      </Card>
    </div>
  );
}
