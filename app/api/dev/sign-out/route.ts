import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DEV_COOKIE, DEV_ENABLED } from "@/lib/dev-auth";

export async function POST(req: Request) {
  if (!DEV_ENABLED) return new NextResponse("Not found", { status: 404 });
  const jar = await cookies();
  jar.delete(DEV_COOKIE);
  return NextResponse.redirect(new URL("/", req.url));
}
