import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SearchX } from "lucide-react";

// Shared 404 UI for the route-group not-found.tsx files. Server component (pulls
// translations); rendered inside its route group's layout, so it keeps the app
// chrome instead of falling back to Next's bare default 404.
export async function NotFoundState({ homeHref }: { homeHref: string }) {
  const t = await getTranslations("errorPage");
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold text-foreground">{t("notFoundTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("notFoundDescription")}</p>
      <Link
        href={homeHref}
        className="mt-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("backHome")}
      </Link>
    </div>
  );
}
