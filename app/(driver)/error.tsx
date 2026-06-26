"use client";

import { ErrorState } from "@/components/error-state";

// Error boundary for the driver segment.
export default function DriverError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorState error={error} retry={unstable_retry} homeHref="/driver" />;
}
