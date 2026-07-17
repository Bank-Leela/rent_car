import { getTranslations } from "next-intl/server";

// Presentational in/out-of-Chula chip, derived from `travelWithinChula`
// (the same flag that forces jobType=WERN at creation). No logic — used on
// detail/queue surfaces.
export async function InChulaChip({ travelWithinChula }: { travelWithinChula: boolean }) {
  const t = await getTranslations("common");
  const outside = !travelWithinChula;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        outside
          ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {outside ? t("outsideChula") : t("inChula")}
    </span>
  );
}
