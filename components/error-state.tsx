"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

// Shared fallback for the route-group error boundaries (error.tsx). Error
// boundaries must be Client Components. `retry` is Next 16's unstable_retry —
// it re-fetches AND re-renders the failed segment (good for transient DB blips).
export function ErrorState({
  error,
  retry,
  homeHref,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref: string;
}) {
  const t = useTranslations("errorPage");
  useEffect(() => {
    // Surface the real error to the console / any reporting hook.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
      <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground/80">{t("reference", { digest: error.digest })}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("retry")}
        </button>
        <Link
          href={homeHref}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("backHome")}
        </Link>
      </div>
    </div>
  );
}
