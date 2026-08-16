import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "@/components/forms/reset-password-form";
import { BrandTile } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("reset");
  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <ThemeToggle tone="page" />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandTile size="lg" tone="brand" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("tagline")}</p>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
          <ResetPasswordForm token={token} />
          <Link
            href="/login"
            className="block text-center text-xs text-primary hover:underline"
          >
            {t("backToSignIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
