import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingForm } from "@/components/forms/booking-form";
import { listDepartments } from "@/lib/departments";

export default async function NewBookingPage() {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations("newBookingPage");
  const locale = await getLocale();

  const departments = await listDepartments(locale);
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { departmentId: true, name: true, username: true, phone: true, email: true },
  });
  const templates = await prisma.tripTemplate.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <BookingForm
        departments={departments}
        defaultDepartmentId={me?.departmentId ?? null}
        defaultAjarnName={me?.name || me?.username || ""}
        defaultAjarnPhone={me?.phone ?? ""}
        defaultAjarnEmail={me?.email ?? ""}
        templates={templates}
        locale={locale}
      />
    </div>
  );
}
