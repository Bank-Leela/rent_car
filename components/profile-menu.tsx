"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { UserCog, KeyRound, LogOut } from "lucide-react";
import { signOutAction } from "@/lib/auth/credentials-actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

function initialsOf(name: string | null, email: string | null): string {
  const src = (name ?? email ?? "").trim();
  if (!src) return "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

// Header profile dropdown: avatar (initials) → name/role, account, change password,
// sign out. Replaces the flat name-link + sign-out button. AppShell (server) passes
// the translated labels.
export function ProfileMenu({
  name,
  email,
  roleLabel,
  labels,
  isDevImpersonation,
}: {
  name: string | null;
  email: string | null;
  roleLabel: string;
  labels: { account: string; changePassword: string; signOut: string };
  isDevImpersonation: boolean;
}) {
  const router = useRouter();
  const signOutFormRef = useRef<HTMLFormElement>(null);
  const display = name ?? email ?? "";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={display || labels.account}
          className="ml-2 grid h-9 w-9 place-items-center rounded-full bg-muted text-xs font-semibold uppercase text-foreground ring-1 ring-inset ring-border transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {initialsOf(name, email)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            {display && <div className="truncate text-sm font-medium">{display}</div>}
            {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
            <div className="mt-0.5 text-xs text-muted-foreground">{roleLabel}</div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push("/account")}>
            <UserCog className="mr-2 h-4 w-4" aria-hidden />
            {labels.account}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/account#password")}>
            <KeyRound className="mr-2 h-4 w-4" aria-hidden />
            {labels.changePassword}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => signOutFormRef.current?.requestSubmit()}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden />
            {labels.signOut}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Sign-out (dev kiosk → route handler, real → server action). Kept outside the
          menu so it stays mounted when the menu closes on select. */}
      <form
        ref={signOutFormRef}
        action={isDevImpersonation ? "/api/dev/sign-out" : signOutAction}
        method={isDevImpersonation ? "post" : undefined}
        className="hidden"
      />
    </>
  );
}
