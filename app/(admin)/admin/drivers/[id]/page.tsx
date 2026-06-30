import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { DriverEditForm } from "@/components/forms/driver-edit-form";
import { DriverCredentials } from "@/components/forms/driver-credentials";

export default async function AdminDriverEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const t = await getTranslations("adminDrivers");

  const driver = await prisma.driver.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, thaiName: true, phone: true, username: true } },
      assignedVehicle: { select: { id: true } },
    },
  });
  if (!driver) notFound();

  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    orderBy: { registrationNumber: "asc" },
    select: { id: true, registrationNumber: true, assignedDriverId: true },
  });
  const vehicleOptions = [
    { value: "", label: t("noVehicle") },
    ...vehicles.map((v) => ({
      value: v.id,
      label:
        v.registrationNumber +
        (v.assignedDriverId && v.assignedDriverId !== driver.id ? ` (${t("assignedElsewhere")})` : ""),
    })),
  ];

  const formDriver = {
    id: driver.id,
    name: driver.user.name ?? "",
    thaiName: driver.user.thaiName ?? "",
    phone: driver.user.phone ?? "",
    nickname: driver.nickname ?? "",
    licenseType: driver.licenseType ?? "",
    licenseNumber: driver.licenseNumber ?? "",
    licenseExpiresAt: driver.licenseExpiresAt ? driver.licenseExpiresAt.toISOString().slice(0, 10) : "",
    position: driver.position ?? "",
    retirementYear: driver.retirementYear?.toString() ?? "",
    notes: driver.notes ?? "",
    isActive: driver.isActive,
    vehicleId: driver.assignedVehicle?.id ?? "",
  };

  return (
    <div className="space-y-6">
      <Link
        href="/admin/drivers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t("backToList")}
      </Link>
      <PageHeader title={driver.user.name ?? driver.user.thaiName ?? t("title")} description={t("editDescription")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("infoTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DriverEditForm driver={formDriver} vehicleOptions={vehicleOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("credentialsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DriverCredentials driverId={driver.id} userId={driver.user.id} username={driver.user.username} />
        </CardContent>
      </Card>
    </div>
  );
}
