"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { JobType } from "@prisma/client";
import { parseQueueSort, DEFAULT_QUEUE_SORT } from "@/lib/admin/queue-sort";
import { QUEUE_JOB_TYPES } from "@/lib/admin/queue-job-types";
import { SelectField } from "@/components/ui/select-field";

export type QueueCounts = {
  /** Rows per job type, already faceted against the overdue toggle + search. */
  jobType: Record<string, number>;
  /** Rows past the SLA, faceted against the job-type selection. */
  overdue: number;
};

/**
 * One filter option: a toggle chip carrying its own count.
 *
 * The count stays — it is what a bare chip was missing, and it answers "is there
 * anything in there" without spending a server round trip to find out. What goes
 * is the ROW. A row per option, at 44 px each with the count pushed to the far
 * right by justify-between, turned a toolbar into a 300 px wall above the queue
 * and left each number stranded ~600 px from its own label.
 *
 * So: label and count adjacent, inside one pill, all of them on one wrapping
 * line. Same information, about a seventh of the height.
 *
 * h-11 keeps the 44 px touch target — the compact version is compact
 * horizontally, not by going back under the minimum.
 */
function FacetChip({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : `bg-background hover:bg-muted ${count === 0 ? "text-muted-foreground/60" : "text-foreground"}`
      }`}
    >
      {label}
      {/* The count rides inside the chip, so it can never drift away from what
          it counts. Tinted rather than plain so it reads as a quantity, not as
          part of the label. */}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
          checked ? "bg-white/20" : "bg-muted text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// Filter/sort panel for the pending queue. All state lives in URL params so a
// filtered view is shareable and survives refresh; changes re-run the server
// query via router.replace.
//
// Grouped checkbox rows rather than a row of chips: a chip carries one bit
// (on/off) and no scale, so a queue of 80 looked identical to a queue of 3 until
// you filtered it. The groups also say WHAT each control filters — the old bar
// ran job types and the SLA toggle together in one undifferentiated line.
//
// It stays in the same slot the chips occupied (QueueBulkProvider's `filters`)
// and lays out in columns rather than a left rail: the queue cards below are
// full-width and dense, and taking 224 px off them permanently to hold six
// checkboxes is a bad trade on the surface P'Top works in all day.
export function QueueFilterBar({ counts }: { counts: QueueCounts }) {
  const t = useTranslations("admin");
  const tjt = useTranslations("jobType");
  const router = useRouter();
  const params = useSearchParams();

  const selectedTypes = (params.get("jobType") ?? "").split(",").filter(Boolean);
  const overdue = params.get("overdue") === "1";
  const sort = parseQueueSort(params.get("sort") ?? undefined);
  const hasFilter = selectedTypes.length > 0 || overdue;

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

  const clear = () =>
    update((sp) => {
      sp.delete("jobType");
      sp.delete("overdue");
    });

  return (
    // One wrapping line, no panel. The bordered card added a box, a shadow and
    // 24 px of padding around what is a toolbar — it competed with the request
    // cards it sits above, which are the actual content.
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {QUEUE_JOB_TYPES.map((jt) => (
        <FacetChip
          key={jt}
          label={tjt(jt)}
          count={counts.jobType[jt] ?? 0}
          checked={selectedTypes.includes(jt)}
          onChange={() => toggleType(jt)}
        />
      ))}

      {/* A hairline, not a heading. The two group headings cost a whole text row
          each to say what four Thai labels already say; a divider keeps the
          "these are different questions" grouping for free. */}
      <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />

      <FacetChip
        label={t("filterOverdue")}
        count={counts.overdue}
        checked={overdue}
        onChange={() => update((sp) => (overdue ? sp.delete("overdue") : sp.set("overdue", "1")))}
      />

      <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />

      {/* SelectField rather than a native <select> — an open <select> is drawn
          by the OS and cannot take the app's theme, so it read as a foreign
          control next to the filter chips. */}
      <SelectField
        aria-label={t("sortLabel")}
        value={sort}
        onValueChange={(v) =>
          update((sp) => (v === DEFAULT_QUEUE_SORT ? sp.delete("sort") : sp.set("sort", v)))
        }
        className="h-11 w-auto rounded-full text-sm"
        options={[
          { value: "start", label: t("sortStart") },
          { value: "oldest", label: t("sortOldest") },
          { value: "risk", label: t("sortRisk") },
        ]}
      />

      {hasFilter && (
        <button
          type="button"
          onClick={clear}
          className="inline-flex h-11 items-center rounded-full px-3 text-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("filterClear")}
        </button>
      )}
    </div>
  );
}
