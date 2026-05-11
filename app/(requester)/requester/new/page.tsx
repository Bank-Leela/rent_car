import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { BookingForm } from "@/components/forms/booking-form";

export default async function NewBookingPage() {
  await requireRole("REQUESTER");
  const t = await getTranslations("newBookingPage");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <BookingForm />
    </div>
  );
}
