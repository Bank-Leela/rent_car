"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RangeFilter({ from, to }: { from: Date; to: Date }) {
  const t = useTranslations("rangeFilter");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [fromStr, setFromStr] = useState(format(from, "yyyy-MM-dd"));
  const [toStr, setToStr] = useState(format(to, "yyyy-MM-dd"));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const params = new URLSearchParams(sp.toString());
        params.set("from", fromStr);
        params.set("to", toStr);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className="flex flex-wrap items-end gap-3 print:hidden"
    >
      <div className="grid gap-1">
        <Label htmlFor="from">{t("from")}</Label>
        <Input id="from" type="date" value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="to">{t("to")}</Label>
        <Input id="to" type="date" value={toStr} onChange={(e) => setToStr(e.target.value)} />
      </div>
      <Button type="submit" size="sm">{t("apply")}</Button>
    </form>
  );
}
