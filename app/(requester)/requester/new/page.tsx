import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingForm } from "@/components/forms/booking-form";

export default async function NewBookingPage() {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations("newBookingPage");
  const locale = await getLocale();

  const departments = await prisma.department.findMany({
    orderBy: locale.toLowerCase().startsWith("th") ? { nameTh: "asc" } : { nameEn: "asc" },
    select: { id: true, nameEn: true, nameTh: true },
  });
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { departmentId: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <BookingForm
        departments={departments}
        defaultDepartmentId={me?.departmentId ?? null}
        locale={locale}
      />
    </div>
  );
}
