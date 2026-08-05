// Thai-only UI. English was removed (2026-08-05): the app serves one audience —
// faculty staff, drivers, and P'Top — and maintaining a parallel English string
// set doubled the review surface of every screen. The next-intl layer stays (the
// t("key") calls are untouched); it just has exactly one locale to resolve
// against, so no translation can drift or need cross-checking.
export const locales = ["th"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "th";
export const LOCALE_COOKIE = "locale";

export function isLocale(value: string | undefined): value is Locale {
  return value === "th";
}

// Kept so the existing call sites still read as "show the Thai form?" — always
// true now. The unused `locale` arg keeps those call sites unchanged; there is
// only one locale left to ask about.
export function isThaiLocale(locale?: string): boolean {
  void locale;
  return true;
}
