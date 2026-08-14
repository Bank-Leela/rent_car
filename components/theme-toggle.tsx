"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTranslations } from "next-intl";

const NEXT: Record<string, "light" | "dark" | "system"> = {
  light: "dark",
  dark: "system",
  system: "light",
};

/**
 * `tone` exists because this control ships on BOTH surfaces. Its classes were
 * hardcoded to the bar palette — text-bar-muted is 68% white — so on the login,
 * forgot-password and reset pages, which have no bar, it rendered white-on-white
 * with a hover of white/10 that produced no visible change at all. An invisible
 * theme switch on the app's front door.
 */
const TOGGLE_BAR =
  "inline-flex h-11 w-11 items-center justify-center rounded-lg text-bar-muted hover:bg-white/10 hover:text-bar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
const TOGGLE_PAGE =
  "inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ThemeToggle({ tone = "bar" }: { tone?: "bar" | "page" }) {
  const cls = tone === "page" ? TOGGLE_PAGE : TOGGLE_BAR;
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const t = useTranslations("common");

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag; next-themes hydration guard (avoid SSR/client mismatch)
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label={t("theme")}
        className={cls}
      >
        <Sun className="h-4 w-4" />
      </button>
    );
  }

  const current = (theme ?? "system") as "light" | "dark" | "system";
  const Icon =
    current === "system" ? Monitor : (resolvedTheme === "dark" ? Moon : Sun);

  return (
    <button
      type="button"
      aria-label={`${t("theme")}: ${current}`}
      onClick={() => setTheme(NEXT[current])}
      className={`${cls} transition-colors`}
      title={current}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
