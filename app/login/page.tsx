import { signIn } from "@/auth";
import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth-helpers";
import { getSession } from "@/lib/session";
import { DEV_ENABLED } from "@/lib/dev-auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Vehicle Booking</CardTitle>
          <CardDescription>
            Sign in with your <code className="font-mono text-xs">@chula.ac.th</code> Google account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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

          {DEV_ENABLED && devUsers.length > 0 && (
            <>
              <div className="relative pt-2">
                <Separator />
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 bg-card px-2 text-xs uppercase text-muted-foreground">
                  Dev impersonation
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                These shortcuts only exist in development. Pick a seeded role to preview the corresponding dashboard.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {devUsers.map((u) => (
                  <form key={u.id} action="/api/dev/sign-in" method="post">
                    <input type="hidden" name="userId" value={u.id} />
                    <Button type="submit" variant="outline" className="w-full justify-start" size="sm">
                      <span className="text-left">
                        <span className="block font-medium capitalize">
                          {u.roles[0]?.role.toLowerCase().replace(/_/g, " ") ?? "user"}
                        </span>
                        <span className="block text-xs text-muted-foreground">{u.email}</span>
                      </span>
                    </Button>
                  </form>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
