"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    // Same surface as EmptyState — solid card, elevation, 56px icon plate — but
    // built inline rather than reusing it because this keeps the destructive
    // tint and carries two actions. It was a bare centred column with a naked
    // 40px icon and two 36px hand-rolled buttons, on a page where the action is
    // the only way out.
    <div className="mx-auto max-w-md rounded-2xl border border-border/70 bg-card px-6 py-12 text-center shadow-e1">
      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20">
        <AlertTriangle className="h-7 w-7" aria-hidden />
      </div>
      <h2 className="text-xl font-semibold tracking-[-0.01em]">{t("title")}</h2>
      <p className="mx-auto mt-2 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
        {t("description")}
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground/80">
          {t("reference", { digest: error.digest })}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" size="xl" onClick={() => retry()}>
          {t("retry")}
        </Button>
        <Button
          variant="outline"
          size="lg"
          nativeButton={false}
          render={<Link href={homeHref} />}
        >
          {t("backHome")}
        </Button>
      </div>
    </div>
  );
}
