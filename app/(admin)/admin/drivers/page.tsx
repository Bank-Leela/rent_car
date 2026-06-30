import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { DriversListClient } from "@/components/admin/drivers-list-client";

export default async function AdminDriversPage() {
  await requireRole("ADMIN");
  const t = await getTranslations("adminDrivers");

  const drivers = await prisma.driver.findMany({
    orderBy: { user: { name: "asc" } },
    include: {
      user: { select: { name: true, thaiName: true, phone: true } },
      assignedVehicle: { select: { registrationNumber: true } },
    },
  });

  const rows = drivers.map((d) => ({
    id: d.id,
    name: d.user.name ?? d.user.thaiName ?? "—",
    nickname: d.nickname,
    phone: d.user.phone,
    vehicle: d.assignedVehicle?.registrationNumber ?? null,
    isActive: d.isActive,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("emptyList")}</p>
          ) : (
            <DriversListClient drivers={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
