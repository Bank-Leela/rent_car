import { redirect } from "next/navigation";

// The sign-in screen is the site root now (`app/page.tsx`). This route survives
// only so old bookmarks, saved links and any stray /login reference still land
// somewhere useful — it forwards the query string so ?error= still shows.
export default async function LoginRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else if (value !== undefined) qs.set(key, value);
  }
  const query = qs.toString();
  redirect(query ? `/?${query}` : "/");
}
