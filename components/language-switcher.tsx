import { getLocale } from "next-intl/server";
import { setLocaleAction } from "@/lib/locale-actions";
import type { Locale } from "@/i18n/config";

export async function LanguageSwitcher() {
  const current = (await getLocale()) as Locale;
  const next: Locale = current === "th" ? "en" : "th";
  const label = current === "th" ? "EN" : "ไทย";
  return (
    <form action={setLocaleAction}>
      <input type="hidden" name="locale" value={next} />
      <button
        type="submit"
        className="rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`Switch language to ${label}`}
      >
        {label}
      </button>
    </form>
  );
}
