"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { provisionDriverProfilesAction } from "@/lib/booking/fleet-actions";

/** Backfills Driver profiles for DRIVER-role users that don't have one yet. */
export function ProvisionDriversButton({
  label,
  busyLabel,
}: {
  label: string;
  busyLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await provisionDriverProfilesAction();
          router.refresh();
        })
      }
    >
      {pending ? busyLabel : label}
    </Button>
  );
}
