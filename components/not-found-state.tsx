import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

// Shared 404 UI for the route-group not-found.tsx files. Server component (pulls
// translations); rendered inside its route group's layout, so it keeps the app
// chrome instead of falling back to Next's bare default 404.
//
// Built on EmptyState rather than hand-rolled. It was a bare centred column on
// the page ground — a naked 40px icon, an 18px title and a 36px outline link —
// which is the exact shape EmptyState was written to replace. On a page whose
// only job is to offer the way out, that link is the page's primary action, so
// it takes the contract's primary treatment: a 48px pill.
export async function NotFoundState({ homeHref }: { homeHref: string }) {
  const t = await getTranslations("errorPage");
  return (
    <EmptyState
      icon={SearchX}
      title={t("notFoundTitle")}
      description={t("notFoundDescription")}
      action={
        <Button size="xl" nativeButton={false} render={<Link href={homeHref} />}>
          {t("backHome")}
        </Button>
      }
    />
  );
}
