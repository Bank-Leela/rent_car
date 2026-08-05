import { getRequestConfig } from "next-intl/server";
import { defaultLocale } from "./config";

// Thai-only: there is no cookie / Accept-Language negotiation left to do — every
// request resolves the single locale. See i18n/config.ts.
export default getRequestConfig(async () => {
  const messages = (await import(`@/messages/${defaultLocale}.json`)).default;
  return { locale: defaultLocale, messages };
});
