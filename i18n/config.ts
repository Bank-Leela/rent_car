export const locales = ["en", "th"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "locale";

export function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "th";
}

// Accepts any BCP-47-ish string ("th", "TH", "th-TH"), not just our Locale
// union, because next-intl's getLocale() returns a plain string.
export function isThaiLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith("th");
}
