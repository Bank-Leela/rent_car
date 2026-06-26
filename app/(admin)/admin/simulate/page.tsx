import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/page-header";
import { SimulateForm } from "@/components/admin/simulate-form";

// What-if placement sandbox: pick a job type + time on a day and see which slot
// (car·driver) the live recommender assigns — read-only, no booking is created.
export default async function SimulatePage() {
  await requireRole("ADMIN");
  const t = await getTranslations("simulate");
  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SimulateForm today={today} />
    </div>
  );
}
