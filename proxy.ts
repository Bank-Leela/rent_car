import { auth } from "@/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/forgot", "/reset", "/api/auth", "/api/dev", "/api/line", "/api/adobe-sign"];
// Paths a user on a temp password can reach without being bounced back to
// /account. They need access to set the new password and to sign out;
// everything else is blocked until the password is rotated.
const PASSWORD_CHANGE_EXEMPT = ["/account", "/api/auth"];
const DEV_COOKIE = "dev_user_id";
const DEV_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_AUTH === "true";

export default auth((req) => {
  const { nextUrl } = req;
  const isPublic = PUBLIC_PATHS.some((p) => nextUrl.pathname.startsWith(p));

  if (isPublic) return NextResponse.next();

  const hasDevCookie = DEV_ENABLED && !!req.cookies.get(DEV_COOKIE)?.value;
  if (!req.auth && !hasDevCookie) {
    const loginUrl = new URL("/login", nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // CR-08: force users on a temp password to /account before they can
  // touch any other surface. Dev-cookie sessions bypass this — they don't
  // carry mustChangePassword, and the impersonation flow is dev-only.
  if (req.auth?.user?.mustChangePassword) {
    const exempt = PASSWORD_CHANGE_EXEMPT.some((p) => nextUrl.pathname.startsWith(p));
    if (!exempt) {
      const accountUrl = new URL("/account", nextUrl.origin);
      accountUrl.searchParams.set("forceChange", "1");
      return NextResponse.redirect(accountUrl);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)"],
};
