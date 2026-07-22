import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { DriverEditForm } from "@/components/forms/driver-edit-form";

// Driver.customFields is stored as JSON; normalise to a typed row list, skipping
// any malformed entries so a bad row can't break the edit page.
function parseCustomFields(raw: unknown): { label: string; value: string }[] {
  if (!Array.isArray(raw)) return [];
  const rows: { label: string; value: string }[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const label = String((item as Record<string, unknown>).label ?? "");
      const value = String((item as Record<string, unknown>).value ?? "");
      if (label) rows.push({ label, value });
    }
  }
  return rows;
}

export default async function AdminDriverEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const t = await getTranslations("adminDrivers");

  const driver = await prisma.driver.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, thaiName: true, phone: true } },
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
    customFields: parseCustomFields(driver.customFields),
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
    </div>
  );
}
