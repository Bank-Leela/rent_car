import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { FleetEditor } from "@/components/admin/fleet-editor";

export default async function FleetPage() {
  await requireRole("ADMIN");
  const t = await getTranslations("fleet");
  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");

  const [cars, drivers] = await Promise.all([
    prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { registrationNumber: "asc" },
      select: { id: true, registrationNumber: true, assignedDriverId: true },
    }),
    prisma.driver.findMany({
      where: { isActive: true },
      select: { id: true, user: { select: { name: true, thaiName: true } } },
    }),
  ]);

  const driverOpts = drivers.map((d) => ({
    id: d.id,
    name: (isThai ? d.user.thaiName ?? d.user.name : d.user.name ?? d.user.thaiName) ?? d.id,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <FleetEditor cars={cars} drivers={driverOpts} />
    </div>
  );
}
