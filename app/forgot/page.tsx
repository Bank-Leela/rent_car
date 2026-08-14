import Link from "next/link";
import { Car } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "@/components/forms/forgot-password-form";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function ForgotPage() {
  const t = await getTranslations("forgot");
  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <ThemeToggle tone="page" />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Car className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("tagline")}</p>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
          <ForgotPasswordForm />
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
