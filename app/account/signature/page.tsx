import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { AccountSection } from "@/components/account/account-section";
import { SignatureForm } from "@/components/forms/signature-form";

/**
 * ลายเซ็น, on a route of its own.
 *
 * It was the fourth of five sections on /account and by far the longest — a
 * name, a file picker, two lines of explanation, an upload-state line and a save
 * button — so it pushed รหัสผ่าน, the section people actually come here for,
 * off the bottom of the screen. It also has a distinct job: the other four are
 * credentials, this one is a document asset that gets stamped into the official
 * booking PDF.
 *
 * No section rail. The rail lists the anchors of /account, and this page is not
 * made of them — every item in it would point away, and none could ever be the
 * current one. ย้อนกลับ is the way back; the profile menu is the way in.
 */
export default async function AccountSignaturePage() {
  const session = await requireUser();
  const t = await getTranslations("account");
  const ts = await getTranslations("signatureForm");
  const tc = await getTranslations("common");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { signatureName: true, signatureImageUrl: true },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={ts("title")}
        description={t("title")}
        actions={
          <Link
            href="/account"
            className="inline-flex h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
          >
            {tc("back")}
          </Link>
        }
      />

      <Card className="gap-0 py-0">
        <AccountSection title={ts("title")} description={ts("description")}>
          <SignatureForm
            userId={session.user.id}
            signatureName={user.signatureName}
            hasSignature={!!user.signatureImageUrl}
          />
        </AccountSection>
      </Card>
    </div>
  );
}
