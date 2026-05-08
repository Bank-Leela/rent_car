import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

async function pickLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const header = (await headers()).get("accept-language") ?? "";
  if (header.toLowerCase().startsWith("th")) return "th";
  return defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await pickLocale();
  const messages = (await import(`@/messages/${locale}.json`)).default;
  return { locale, messages };
});
