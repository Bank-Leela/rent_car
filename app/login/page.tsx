import Link from "next/link";
import { redirect } from "next/navigation";
import { Car } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { homePathFor } from "@/lib/auth-helpers";
import { getSession } from "@/lib/session";
import { DEV_ENABLED } from "@/lib/dev-auth";
import { prisma } from "@/lib/db";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignInForm } from "@/components/forms/sign-in-form";

const ROLE_TINT: Record<string, string> = {
  ADMIN:
    "border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100/70 text-indigo-950 dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:hover:bg-indigo-500/20 dark:text-indigo-100",
  DRIVER:
    "border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/70 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/20 dark:text-emerald-100",
  REQUESTER:
    "border-sky-200 bg-sky-50/60 hover:bg-sky-100/70 text-sky-950 dark:border-sky-400/30 dark:bg-sky-500/15 dark:hover:bg-sky-500/20 dark:text-sky-100",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const session = await getSession();
  if (session?.user) redirect(homePathFor(session.user.roles));
  const { error } = await searchParams;
  const t = await getTranslations();

  const devUsers = DEV_ENABLED
    ? await prisma.user.findMany({
        // Station-only driver model: drivers sign in at the shared station kiosk,
        // not as individuals — so exclude the individual driver, keep driverstation.
        where: { id: { startsWith: "seed-user-", not: "seed-user-driver" } },
        include: { roles: true },
        orderBy: { email: "asc" },
      })
    : [];

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Car className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("login.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("login.tagline")}</p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm dark:shadow-[0_8px_32px_-12px_rgba(0,0,0,0.6)] dark:ring-1 dark:ring-white/5">
          <div className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {t("login.signInFailed")}
              </div>
            )}

            <SignInForm />

            <div className="flex items-center justify-between text-xs">
              <Link
                href="/forgot"
                className="text-primary hover:underline focus-visible:outline-none focus-visible:underline"
              >
                {t("login.forgotPassword")}
              </Link>
              <span className="text-muted-foreground">{t("login.adminProvisioned")}</span>
            </div>

            {DEV_ENABLED && devUsers.length > 0 && (
              <div className="space-y-3">
                <div className="relative pt-3">
                  <div className="h-px bg-border" />
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-card px-2 text-xs uppercase tracking-wider text-muted-foreground">
                    {t("login.previewAs")}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {devUsers.map((u) => {
                    const role = u.roles[0]?.role ?? "";
                    return (
                      <form key={u.id} action="/api/dev/sign-in" method="post">
                        <input type="hidden" name="userId" value={u.id} />
                        <button
                          type="submit"
                          className={`w-full min-h-12 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                            ROLE_TINT[role] ?? "bg-muted/40 hover:bg-muted"
                          }`}
                        >
                          <span className="block text-sm font-medium">
                            {role ? t(`roles.${role}` as `roles.${"REQUESTER"|"ADMIN"|"DRIVER"}`) : "user"}
                          </span>
                          <span className="block text-xs opacity-70 truncate">
                            {u.email}
                          </span>
                        </button>
                      </form>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

