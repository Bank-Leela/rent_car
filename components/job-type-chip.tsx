import { getTranslations } from "next-intl/server";
import type { JobType } from "@prisma/client";
import { jobStyle } from "@/components/admin/scheduler-board-shared";

// The trip's kind, as a chip. The queue filters BY job type, so the cards it
// filters have to say which one they are — otherwise a filtered queue is a list
// of rows with nothing on them explaining why they survived the filter.
//
// Colours come from the board's JOB_COLOR, so a TJW is the same blue here as on
// the timeline; the label comes from the `jobType` namespace, so it matches the
// filter chips word for word.
export async function JobTypeChip({ jobType }: { jobType: JobType }) {
  const t = await getTranslations("jobType");
  const { dot } = jobStyle(jobType);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      {t(jobType)}
    </span>
  );
}
