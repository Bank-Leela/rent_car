"use client";

import { ErrorState } from "@/components/error-state";

// Error boundary for the whole admin segment — a thrown server action or RSC
// query renders this themed, translatable fallback instead of Next's bare page.
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorState error={error} retry={unstable_retry} homeHref="/admin/schedule" />;
}
