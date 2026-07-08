import { getLocale, getTranslations } from "next-intl/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { FleetEditor } from "@/components/admin/fleet-editor";
import { ProvisionDriversButton } from "@/components/admin/provision-drivers-button";

export default async function FleetPage() {
  await requireRole("ADMIN");
  const t = await getTranslations("fleet");
  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");

  const [cars, drivers, missingProfiles] = await Promise.all([
    prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { registrationNumber: "asc" },
      select: { id: true, registrationNumber: true, assignedDriverId: true, type: true, capacity: true },
    }),
    prisma.driver.findMany({
      // Only assignable drivers: active profile AND active user.
      where: { isActive: true, user: { is: { isActive: true } } },
      select: { id: true, user: { select: { name: true, thaiName: true } } },
    }),
    // DRIVER-role users with no Driver profile yet (the "add a driver" gap).
    prisma.user.count({
      where: { isActive: true, roles: { some: { role: Role.DRIVER } }, driverProfile: { is: null } },
    }),
  ]);

  const driverOpts = drivers.map((d) => ({
    id: d.id,
    name: (isThai ? d.user.thaiName ?? d.user.name : d.user.name ?? d.user.thaiName) ?? d.id,
  }));

  // Flatten the assigned-driver label onto each car so client-side search can
  // match on driver name (derived from already-fetched data — no extra query).
  const driverNameById = new Map(driverOpts.map((d) => [d.id, d.name]));
  const carRows = cars.map((c) => ({
    ...c,
    driverName: c.assignedDriverId ? driverNameById.get(c.assignedDriverId) ?? "" : "",
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      {missingProfiles > 0 && (
        <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/40 dark:bg-amber-950/40">
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {t("missingProfilesTitle", { count: missingProfiles })}
            </p>
            <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
              {t("missingProfilesBody")}
            </p>
          </div>
          <ProvisionDriversButton label={t("provisionAction")} busyLabel={t("provisioning")} />
        </div>
      )}
      <FleetEditor cars={carRows} drivers={driverOpts} />
    </div>
  );
}
