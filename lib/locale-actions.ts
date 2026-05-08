"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

export async function setLocaleAction(formData: FormData): Promise<void> {
  const value = String(formData.get("locale") ?? "");
  if (!isLocale(value)) return;
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, value, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/");
}
