import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEV_COOKIE, DEV_ENABLED } from "@/lib/dev-auth";

export async function POST(req: Request) {
  if (!DEV_ENABLED) return new NextResponse("Not found", { status: 404 });

  const form = await req.formData();
  const userId = String(form.get("userId") ?? "");
  if (!userId) return new NextResponse("Missing userId", { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return new NextResponse("Unknown user", { status: 404 });

  const jar = await cookies();
  jar.set(DEV_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.redirect(new URL("/", req.url));
}
