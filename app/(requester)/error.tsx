"use client";

import { ErrorState } from "@/components/error-state";

// Error boundary for the requester segment.
export default function RequesterError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorState error={error} retry={unstable_retry} homeHref="/requester" />;
}
