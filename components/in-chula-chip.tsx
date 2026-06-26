import { getTranslations } from "next-intl/server";

// Sub-project A: presentational in/out-of-Chula chip. Reads `outsideChula`
// (the campus/off-campus bit). No logic — used on detail/queue surfaces.
export async function InChulaChip({ outsideChula }: { outsideChula: boolean }) {
  const t = await getTranslations("common");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        outsideChula
          ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {outsideChula ? t("outsideChula") : t("inChula")}
    </span>
  );
}
