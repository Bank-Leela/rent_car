"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/booking/actions";

type Action = (formData: FormData) => Promise<ActionResult | void>;

/**
 * Shared form-submit state machine used across the booking forms: tracks
 * `error` + `pending`, optionally stamps a `bookingId` onto the FormData, runs
 * the server action inside a transition, and surfaces `res.error` on failure.
 *
 * `run` is a `(formData) => void` — pass it straight to `<form action={run}>`,
 * or call it with a hand-built FormData for button-driven actions. `onSuccess`
 * fires when the action resolves ok (or returns void), e.g. `router.refresh()`.
 */
export function useFormAction(
  action: Action,
  opts?: { bookingId?: string; onSuccess?: () => void },
) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(formData: FormData) {
    setError(null);
    if (opts?.bookingId !== undefined) formData.set("bookingId", opts.bookingId);
    startTransition(async () => {
      const res = await action(formData);
      if (res && !res.ok) setError(res.error);
      else opts?.onSuccess?.();
    });
  }

  return { error, setError, pending, run };
}
