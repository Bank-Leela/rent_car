"use client";

import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import type { DriverRow } from "@/components/admin/drivers-list-client";

// Client-side CSV of the driver roster (the columns the paper sheet tracks).
// UTF-8 BOM so Thai text opens correctly in Excel.
export function RosterCsvButton({ rows }: { rows: DriverRow[] }) {
  const t = useTranslations("adminDrivers");

  const download = () => {
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["name", "nickname", "phone", "licenseType", "licenseNumber", "licenseExpiresAt", "position", "retirementYear", "vehicle", "active", "notes"];
    const lines = [
      header.join(","),
      ...rows.map((d) =>
        [
          esc(d.name),
          esc(d.nickname),
          esc(d.phone),
          esc(d.licenseType),
          esc(d.licenseNumber),
          esc(d.licenseExpiresAt ? d.licenseExpiresAt.slice(0, 10) : ""),
          esc(d.position),
          esc(d.retirementYear),
          esc(d.vehicle),
          d.isActive ? "yes" : "no",
          esc(d.notes),
        ].join(","),
      ),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "driver-roster.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={download}
      className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-3.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden"
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      {t("exportCsv")}
    </button>
  );
}
