import Link from "next/link";
import { cookies } from "next/headers";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { DEV_COOKIE, DEV_ENABLED } from "@/lib/dev-auth";
import type { Role } from "@prisma/client";

type NavItem = { href: string; label: string };

export async function AppShell({
  title,
  roleBadge,
  user,
  nav,
  children,
}: {
  title: string;
  roleBadge: string;
  user: { name?: string | null; email?: string | null; roles: Role[] };
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const isDevImpersonation = DEV_ENABLED && !!(await cookies()).get(DEV_COOKIE);
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-semibold">
              {title}
            </Link>
            <Badge variant="secondary">{roleBadge}</Badge>
          </div>
          <nav className="flex items-center gap-2">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2.5 py-1 text-sm hover:bg-muted"
              >
                {item.label}
              </Link>
            ))}
            <Separator orientation="vertical" className="mx-1 h-6" />
            <span className="hidden sm:inline text-sm text-muted-foreground">
              {user.name ?? user.email}
            </span>
            {isDevImpersonation ? (
              <form action="/api/dev/sign-out" method="post">
                <Button type="submit" variant="outline" size="sm">
                  Sign out
                </Button>
              </form>
            ) : (
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <Button type="submit" variant="outline" size="sm">
                  Sign out
                </Button>
              </form>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">{children}</main>
    </div>
  );
}
