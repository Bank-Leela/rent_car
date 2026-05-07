import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { homePathFor } from "@/lib/auth-helpers";

export default async function Home() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  redirect(homePathFor(session.user.roles));
}
