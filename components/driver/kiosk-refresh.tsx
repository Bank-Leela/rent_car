"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";

// The kiosk is a passive display — drivers never claim, P'Top assigns — so new
// work must appear WITHOUT anyone touching the screen. Re-fetches the server
// component every `intervalSec` while the tab is visible (router.refresh keeps
// client state; no websocket/SWR dependency).
export function KioskRefresh({ intervalSec = 60 }: { intervalSec?: number }) {
  const t = useTranslations("driver");
  const router = useRouter();
  const [stamp, setStamp] = useState<string | null>(null);

  useEffect(() => {
    const mark = () =>
      setStamp(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    mark();
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      mark();
    }, intervalSec * 1000);
    return () => clearInterval(id);
  }, [router, intervalSec]);

  const refreshNow = () => {
    router.refresh();
    setStamp(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  };

  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      {stamp && <span>{t("kioskUpdated", { time: stamp })}</span>}
      <button
        type="button"
        onClick={refreshNow}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        {t("kioskRefresh")}
      </button>
    </span>
  );
}
