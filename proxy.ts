import { auth } from "@/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/dev", "/api/line"];
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

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)"],
};
