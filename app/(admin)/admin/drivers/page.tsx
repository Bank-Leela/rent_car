import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { DriversListClient } from "@/components/admin/drivers-list-client";
import { RosterCsvButton } from "@/components/admin/roster-csv-button";
import { CreateDriverForm } from "@/components/forms/create-driver-form";
import { licenseStatus, retirementStatus } from "@/lib/admin/roster-alerts";

export default async function AdminDriversPage() {
  await requireRole("ADMIN");
  const t = await getTranslations("adminDrivers");
  const now = new Date();

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
    // Roster-sheet alert data (license expiry window / BE retirement year) —
    // statuses computed here with the shared helpers so the list badges and
    // the dashboard alerts card always agree.
    licenseType: d.licenseType,
    licenseNumber: d.licenseNumber,
    licenseExpiresAt: d.licenseExpiresAt?.toISOString() ?? null,
    licenseState: licenseStatus(d.licenseExpiresAt, now),
    retirementYear: d.retirementYear,
    retirementState: retirementStatus(d.retirementYear, now),
    position: d.position,
    notes: d.notes,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("addDriver")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateDriverForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{t("listTitle")}</CardTitle>
            {rows.length > 0 && <RosterCsvButton rows={rows} />}
          </div>
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
