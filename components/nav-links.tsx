"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

type NavItem = { href: string; label: string };

// Role roots like "/admin", "/driver", "/requester" only match exactly, so a
// sub-route like "/admin/calendar" doesn't also light up the parent "Queue".
const ROLE_ROOTS = new Set(["/", "/admin", "/driver", "/requester"]);

function isActive(pathname: string, href: string) {
  if (ROLE_ROOTS.has(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

// These render INSIDE the branded bar, so they take the bar's palette, not the
// page's. bg-muted/text-muted-foreground on a deep indigo bar is dark-on-dark:
// the active pill vanished and the inactive labels sat well under 4.5:1.
function navItemClass(active: boolean) {
  return [
    "inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
    active
      ? "bg-bar-accent text-bar-foreground"
      : "text-bar-muted hover:bg-white/10 hover:text-bar-foreground",
  ].join(" ");
}

// `disabled`: the bar is shown but nothing in it navigates — the temp-password
// lock (proxy.ts) bounces every other route back to /account, so live links
// would ping-pong. Rendered as spans, not disabled links, so nothing is
// focusable or clickable.
// `disabledReason` is the text of the lock, surfaced on hover. Dimming answers
// "is this clickable" but not "why isn't it" — the banner explaining the lock is
// further down the page, so someone who goes straight for the nav clicks a dead
// link and learns nothing. Passed in rather than named here: this component has
// no business knowing about passwords.
export function NavLinks({
  items,
  disabled,
  disabledReason,
}: {
  items: NavItem[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const pathname = usePathname();
  return (
    <div className="hidden md:flex items-center gap-1">
      {items.map((item) =>
        disabled ? (
          <span
            key={item.href}
            aria-disabled
            title={disabledReason}
            className="inline-flex h-11 cursor-not-allowed items-center rounded-lg px-3 text-sm font-medium text-bar-foreground/40"
          >
            {item.label}
          </span>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
            className={navItemClass(isActive(pathname, item.href))}
          >
            {item.label}
          </Link>
        ),
      )}
    </div>
  );
}

export function MobileNav({
  items,
  disabled,
  disabledReason,
}: {
  items: NavItem[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-bar-muted hover:bg-white/10 hover:text-bar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/20"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 right-0 top-14 z-50 border-b bg-background shadow-lg">
            {/* Stated once at the top rather than per item: a title tooltip does
                nothing on touch, and the reason is the same for every row. */}
            {disabled && disabledReason && (
              <p className="mx-auto max-w-7xl px-4 pt-3 text-xs text-amber-700 dark:text-amber-400">
                {disabledReason}
              </p>
            )}
            <ul className="mx-auto max-w-7xl px-4 py-2">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    {disabled ? (
                      <span
                        aria-disabled
                        className="flex min-h-11 cursor-not-allowed items-center rounded-md px-3 text-sm font-medium text-muted-foreground/50"
                      >
                        {item.label}
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={[
                          "flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        ].join(" ")}
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
