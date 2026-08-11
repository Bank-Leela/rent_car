"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { JobType } from "@prisma/client";
import { parseQueueSort, DEFAULT_QUEUE_SORT } from "@/lib/admin/queue-sort";
import { SelectField } from "@/components/ui/select-field";

const JOB_TYPES: JobType[] = ["NORMAL", "OT", "TJW", "WERN", "SMUS"];

// Filter/sort bar for the pending queue. All state lives in URL params so a
// filtered view is shareable and survives refresh; changes re-run the server
// query via router.replace.
export function QueueFilterBar() {
  const t = useTranslations("admin");
  const tjt = useTranslations("jobType");
  const router = useRouter();
  const params = useSearchParams();

  const selectedTypes = (params.get("jobType") ?? "").split(",").filter(Boolean);
  const overdue = params.get("overdue") === "1";
  const sort = parseQueueSort(params.get("sort") ?? undefined);

  const update = (mutate: (sp: URLSearchParams) => void) => {
    const sp = new URLSearchParams(params.toString());
    mutate(sp);
    sp.delete("limit"); // filter changes reset the show-more window
    const qs = sp.toString();
    router.replace(qs ? `/admin?${qs}` : "/admin", { scroll: false });
  };

  const toggleType = (jt: JobType) => {
    update((sp) => {
      const cur = (sp.get("jobType") ?? "").split(",").filter(Boolean);
      const next = cur.includes(jt) ? cur.filter((x) => x !== jt) : [...cur, jt];
      if (next.length) sp.set("jobType", next.join(","));
      else sp.delete("jobType");
    });
  };

  const chip = (active: boolean) =>
    `inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "bg-background text-muted-foreground hover:bg-muted"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {JOB_TYPES.map((jt) => (
        <button key={jt} type="button" onClick={() => toggleType(jt)} aria-pressed={selectedTypes.includes(jt)} className={chip(selectedTypes.includes(jt))}>
          {tjt(jt)}
        </button>
      ))}
      <button
        type="button"
        onClick={() => update((sp) => (overdue ? sp.delete("overdue") : sp.set("overdue", "1")))}
        aria-pressed={overdue}
        className={chip(overdue)}
      >
        {t("filterOverdue")}
      </button>
      {/* SelectField rather than a native <select> — an open <select> is drawn
          by the OS and cannot take the app's theme, so it read as a foreign
          control next to the filter chips. */}
      <span className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{t("sortLabel")}</span>
        <SelectField
          aria-label={t("sortLabel")}
          value={sort}
          onValueChange={(v) => update((sp) => (v === DEFAULT_QUEUE_SORT ? sp.delete("sort") : sp.set("sort", v)))}
          className="h-8 w-auto text-xs"
          options={[
            { value: "start", label: t("sortStart") },
            { value: "oldest", label: t("sortOldest") },
            { value: "risk", label: t("sortRisk") },
          ]}
        />
      </span>
    </div>
  );
}
