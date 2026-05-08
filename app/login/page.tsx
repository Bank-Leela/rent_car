import { signIn } from "@/auth";
import { redirect } from "next/navigation";
import { Car } from "lucide-react";
import { homePathFor } from "@/lib/auth-helpers";
import { getSession } from "@/lib/session";
import { DEV_ENABLED } from "@/lib/dev-auth";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";

const ROLE_TINT: Record<string, string> = {
  ADMIN:
    "border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100/70 dark:border-indigo-900/40 dark:bg-indigo-950/30",
  APPROVER:
    "border-fuchsia-200 bg-fuchsia-50/60 hover:bg-fuchsia-100/70 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/30",
  DRIVER:
    "border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/70 dark:border-emerald-900/40 dark:bg-emerald-950/30",
  REQUESTER:
    "border-sky-200 bg-sky-50/60 hover:bg-sky-100/70 dark:border-sky-900/40 dark:bg-sky-950/30",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const session = await getSession();
  if (session?.user) redirect(homePathFor(session.user.roles));
  const { error, callbackUrl } = await searchParams;

  const devUsers = DEV_ENABLED
    ? await prisma.user.findMany({
        where: { id: { startsWith: "seed-user-" } },
        include: { roles: true },
        orderBy: { email: "asc" },
      })
    : [];
  const previewMode = process.env.ENABLE_DEV_AUTH === "true" && process.env.NODE_ENV === "production";

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Car className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Vehicle Booking</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Faculty fleet booking, approvals, and dispatch in one place.
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-4">
            {error === "DomainNotAllowed" && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                Only @chula.ac.th accounts can sign in.
              </div>
            )}
            {error && error !== "DomainNotAllowed" && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                Sign-in failed. Please try again.
              </div>
            )}

            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: callbackUrl ?? "/" });
              }}
            >
              <Button type="submit" className="w-full" size="lg">
                Continue with Google
              </Button>
            </form>
            <p className="text-center text-xs text-muted-foreground">
              Restricted to <code className="rounded bg-muted px-1 py-0.5 font-mono">@chula.ac.th</code> accounts.
            </p>

            {DEV_ENABLED && devUsers.length > 0 && (
              <div className="space-y-3">
                <div className="relative pt-3">
                  <div className="h-px bg-border" />
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-card px-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Preview as
                  </span>
                </div>

                {previewMode && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
                    ⚠ Preview mode is on in this deployment. Disable <code>ENABLE_DEV_AUTH</code> before sharing publicly.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {devUsers.map((u) => {
                    const role = u.roles[0]?.role ?? "";
                    return (
                      <form key={u.id} action="/api/dev/sign-in" method="post">
                        <input type="hidden" name="userId" value={u.id} />
                        <button
                          type="submit"
                          className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                            ROLE_TINT[role] ?? "bg-muted/40 hover:bg-muted"
                          }`}
                        >
                          <span className="block text-sm font-medium capitalize">
                            {role.toLowerCase().replace(/_/g, " ") || "user"}
                          </span>
                          <span className="block text-xs text-muted-foreground truncate">
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
