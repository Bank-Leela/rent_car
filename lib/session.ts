import { auth } from "@/auth";
import { getDevSession } from "@/lib/dev-auth";

export async function getSession() {
  const dev = await getDevSession();
  if (dev) return dev;
  return auth();
}
