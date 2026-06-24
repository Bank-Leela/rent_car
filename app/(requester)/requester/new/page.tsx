import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingForm } from "@/components/forms/booking-form";

export default async function NewBookingPage() {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations("newBookingPage");
  const locale = await getLocale();

  const isThai = locale.toLowerCase().startsWith("th");
  // Department is locked to the requester's own profile (edited on /account).
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { department: { select: { id: true, nameEn: true, nameTh: true } } },
  });
  const userDepartment = me?.department
    ? { id: me.department.id, name: isThai ? me.department.nameTh : me.department.nameEn }
    : null;
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    orderBy: { registrationNumber: "asc" },
    select: { id: true, registrationNumber: true, capacity: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <BookingForm vehicles={vehicles} userDepartment={userDepartment} />
    </div>
  );
}
