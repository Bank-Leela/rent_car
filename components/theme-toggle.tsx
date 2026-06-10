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

export function ThemeToggle() {
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
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
      title={current}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
