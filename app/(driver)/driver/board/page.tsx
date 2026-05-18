import Link from "next/link";
import { format } from "date-fns";
import { ClipboardList, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ClaimButton } from "@/components/forms/claim-form";

export default async function DriverBoard() {
  const session = await requireRole("DRIVER");
  const t = await getTranslations("driverBoard");

  const me = await prisma.driver.findUnique({ where: { userId: session.user.id } });
  if (!me) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={t("noProfileTitle")}
        description={t("noProfileDescription")}
      />
    );
  }
  const driverId = me.id;

  // Trips waiting for someone to take them. APPROVED + vehicle allocated by
  // the admin = ready for the driver pool to self-organize.
  const rows = await prisma.booking.findMany({
    where: { status: "APPROVED" },
    orderBy: { startAt: "asc" },
    include: {
      vehicle: true,
      department: true,
      claims: { where: { status: "ACTIVE" }, include: { driver: { include: { user: true } } } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((b) => {
            const primary = b.claims.find((c) => c.role === "PRIMARY");
            const secondary = b.claims.find((c) => c.role === "SECONDARY");
            const iAmPrimary = primary?.driverId === driverId;
            const iAmSecondary = secondary?.driverId === driverId;
            const iAmClaimed = iAmPrimary || iAmSecondary;
            return (
              <li
                key={b.id}
                className="rounded-xl border bg-card p-4 shadow-sm space-y-3"
              >
                <Link href={`/driver/${b.id}`} className="block group">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                    <span className="text-xs text-muted-foreground">{b.department.nameEn}</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="text-lg font-semibold tabular-nums">
                      {format(b.startAt, "EEE d MMM HH:mm")}
                    </span>
                    <span className="text-sm text-muted-foreground">→ {format(b.endAt, "HH:mm")}</span>
                  </div>
                  <div className="text-sm">{b.destination}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {b.vehicle ? b.vehicle.registrationNumber : t("noVehicleYet")} · {b.passengerCount} pax
                    {b.estimatedDistance != null ? ` · ~${b.estimatedDistance} km` : ""}
                  </div>
                  {b.outOfHoursReason && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      {t("outOfHoursTag")}: {b.outOfHoursReason}
                    </p>
                  )}
                </Link>

                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <SlotRow
                    label={t("primary")}
                    taken={!!primary}
                    name={primary?.driver.user.name ?? primary?.driver.user.email ?? ""}
                    youAre={iAmPrimary}
                    you={t("you")}
                    youHave={t("youHaveThisSlot")}
                  >
                    {!primary && (
                      <ClaimButton bookingId={b.id} role="PRIMARY" disabled={iAmClaimed && !iAmPrimary} />
                    )}
                  </SlotRow>
                  <SlotRow
                    label={t("secondary")}
                    taken={!!secondary}
                    name={secondary?.driver.user.name ?? secondary?.driver.user.email ?? ""}
                    youAre={iAmSecondary}
                    you={t("you")}
                    youHave={t("youHaveThisSlot")}
                  >
                    {!secondary && (
                      <ClaimButton bookingId={b.id} role="SECONDARY" disabled={iAmClaimed && !iAmSecondary} />
                    )}
                  </SlotRow>
                </div>

                <Link
                  href={`/driver/${b.id}`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t("openDetail")} <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SlotRow({
  label,
  taken,
  name,
  youAre,
  you,
  youHave,
  children,
}: {
  label: string;
  taken: boolean;
  name: string;
  youAre: boolean;
  you: string;
  youHave: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {taken ? (
        <div className="mt-0.5 font-medium">
          {youAre ? you : name}
          {youAre && <span className="ml-2 text-xs text-muted-foreground">· {youHave}</span>}
        </div>
      ) : (
        <div className="mt-1">{children}</div>
      )}
    </div>
  );
}
