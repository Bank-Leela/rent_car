"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select-field";
import { adminCreateDriverAction } from "@/lib/admin/driver-actions";
import { useActionToast } from "@/components/hooks/use-action-toast";

// Add a driver to the roster. Drivers log in via the shared station kiosk, so no
// email/username/password is collected — just the roster identity.
export function CreateDriverForm() {
  const t = useTranslations("adminDrivers");
  const te = useTranslations("errors");
  const { toastResult } = useActionToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [pool, setPool] = useState("PUBLIC");
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) => {
        fd.set("pool", pool);
        startTransition(async () => {
          const res = await adminCreateDriverAction(fd);
          toastResult(res.ok ? res : { ok: false, error: te(res.error) }, { success: t("created") });
          if (res.ok) {
            formRef.current?.reset();
            setPool("PUBLIC");
          }
        });
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="new-driver-name">{t("name")}</Label>
        <Input id="new-driver-name" name="name" required autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-driver-thaiName">{t("thaiName")}</Label>
        <Input id="new-driver-thaiName" name="thaiName" autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-driver-nickname">{t("nickname")}</Label>
        <Input id="new-driver-nickname" name="nickname" autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-driver-phone">{t("phone")}</Label>
        <Input id="new-driver-phone" name="phone" autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-driver-pool">{t("pool")}</Label>
        <SelectField
          id="new-driver-pool"
          name="pool"
          value={pool}
          onValueChange={setPool}
          className="h-10"
          options={[
            { value: "PUBLIC", label: t("poolPublic") },
            { value: "PRIVATE", label: t("poolPrivate") },
          ]}
        />
      </div>
      {/* justify-self-start, not sm:w-auto — grid items stretch by default, so the
          submit rendered as a page-wide banner. Same fix as create-user-form. */}
      <Button
        type="submit"
        size="xl"
        disabled={pending}
        className="w-full sm:col-span-2 sm:w-auto sm:justify-self-start"
      >
        {pending ? t("creating") : t("addDriver")}
      </Button>
    </form>
  );
}
