import { getTranslations } from "next-intl/server";

export type AccountSection = {
  /** Anchor id of the section on /account. */
  id: string;
  label: string;
  /** Absolute, so a deep link from anywhere lands on the right section. */
  href: string;
};

/**
 * The sections of /account, in the order the rail lists them.
 *
 * One list, read by the rail and by the page body, so a section can never
 * appear in one and not the other.
 *
 * ลายเซ็น is deliberately absent. It moved to /account/signature — it was the
 * longest of the five (a name, a file picker, a preview and a save) and pushed
 * รหัสผ่าน off the bottom — and a rail entry for a page that is not made of
 * these sections would be the odd one out in a list of in-page anchors. It is
 * reached from the profile menu, which is where it was always linked from.
 */
export async function accountSections(): Promise<AccountSection[]> {
  const t = await getTranslations("account");
  return [
    { id: "email", label: t("emailTitle"), href: "/account#email" },
    { id: "username", label: t("usernameTitle"), href: "/account#username" },
    { id: "department", label: t("departmentTitle"), href: "/account#department" },
    { id: "password", label: t("passwordTitle"), href: "/account#password" },
  ];
}
