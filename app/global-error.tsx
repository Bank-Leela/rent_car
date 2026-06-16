"use client";

import { useEffect } from "react";
import "./globals.css";

// Last-resort boundary: catches throws in the root layout AND in the route-group
// layouts (e.g. the admin layout's booking-count query) that the per-segment
// error.tsx cannot. It replaces the root layout, so it must define its own
// <html>/<body> and cannot use the next-intl provider — hence bilingual static
// copy rather than translated strings.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="th">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
          <h2 className="text-lg font-semibold">เกิดข้อผิดพลาด · Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง · An unexpected error occurred. Please try again.
          </p>
          {error.digest ? (
            <p className="font-mono text-xs text-muted-foreground">Ref: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="mt-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ลองใหม่ · Try again
          </button>
        </div>
      </body>
    </html>
  );
}
