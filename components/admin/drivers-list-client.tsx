"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Users, ChevronRight } from "lucide-react";
import { ListSearch } from "@/components/list-search";
import { EmptyState } from "@/components/empty-state";

interface DriverRow {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  vehicle: string | null;
  isActive: boolean;
}

export function DriversListClient({ drivers }: { drivers: DriverRow[] }) {
  const t = useTranslations("adminDrivers");
  const ts = useTranslations("listSearch");
  return (
    <ListSearch
      items={drivers}
      keys={["name", "nickname", "phone", "vehicle"]}
      render={(rows) =>
        rows.length === 0 ? (
          <EmptyState icon={Users} title={ts("noMatches")} />
        ) : (
          <ul className="divide-y">
            {rows.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/admin/drivers/${d.id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:opacity-90"
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      {d.name}
                      {d.nickname ? <span className="text-muted-foreground"> ({d.nickname})</span> : null}
                      {!d.isActive && (
                        <span className="ml-2 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
                          {t("inactiveBadge")}
                        </span>
                      )}
                    </div>
                    <div className="space-x-2 text-xs text-muted-foreground">
                      <span>{d.phone ?? t("noPhone")}</span>
                      <span>·</span>
                      <span>{d.vehicle ?? t("noVehicle")}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}
