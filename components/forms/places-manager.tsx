"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { createPlaceAction, updatePlaceAction, deletePlaceAction } from "@/lib/places/actions";

type Place = {
  id: string;
  label: string;
  destination: string;
  province: string;
  googleMapsUrl: string | null;
};

type PlaceActionResult = { ok: true } | { ok: false; error: string; field?: string };

export function PlacesManager({ places }: { places: Place[] }) {
  const t = useTranslations("places");
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (
    action: (f: FormData) => Promise<PlaceActionResult>,
    f: FormData,
    onDone?: () => void,
  ) =>
    start(async () => {
      const res = await action(f);
      if (res.ok) {
        onDone?.();
        router.refresh();
      }
    });

  return (
    <div className="space-y-6">
      {places.length === 0 ? (
        <EmptyState icon={MapPinOff} title={t("emptyTitle")} description={t("empty")} />
      ) : (
        <ul className="divide-y rounded-md border">
          {places.map((p) =>
            editing === p.id ? (
              <li key={p.id} className="p-3">
                <PlaceFields prefix={p.id} initial={p} />
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      const f = new FormData();
                      f.append("id", p.id);
                      for (const k of ["label", "destination", "province", "googleMapsUrl"]) {
                        const el = document.getElementById(`${p.id}-${k}`) as HTMLInputElement | null;
                        f.append(k, el?.value ?? "");
                      }
                      submit(updatePlaceAction, f, () => setEditing(null));
                    }}
                  >
                    {t("update")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>
                    {t("cancel")}
                  </Button>
                </div>
              </li>
            ) : (
              <li key={p.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium">{p.label}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.destination}, {p.province}
                  </p>
                  {p.googleMapsUrl && (
                    <a
                      href={p.googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      {t("mapsLink")}
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(p.id)}>
                    {t("edit")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(t("deleteConfirm"))) return;
                      const f = new FormData();
                      f.append("id", p.id);
                      submit(deletePlaceAction, f);
                    }}
                  >
                    {t("delete")}
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <form
        className="space-y-3 rounded-md border bg-muted/30 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          submit(createPlaceAction, f, () => form.reset());
        }}
      >
        <p className="text-sm font-semibold">{t("addTitle")}</p>
        <PlaceFields prefix="new" />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </form>
    </div>
  );
}

function PlaceFields({ prefix, initial }: { prefix: string; initial?: Place }) {
  const t = useTranslations("places");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`${prefix}-label`}>{t("label")}</Label>
        <Input id={`${prefix}-label`} name="label" defaultValue={initial?.label} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${prefix}-province`}>{t("province")}</Label>
        <Input id={`${prefix}-province`} name="province" defaultValue={initial?.province} required />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={`${prefix}-destination`}>{t("destination")}</Label>
        <Input id={`${prefix}-destination`} name="destination" defaultValue={initial?.destination} required />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor={`${prefix}-googleMapsUrl`}>{t("mapsLink")}</Label>
        <Input
          id={`${prefix}-googleMapsUrl`}
          name="googleMapsUrl"
          type="url"
          defaultValue={initial?.googleMapsUrl ?? ""}
          placeholder="https://maps.app.goo.gl/…"
        />
      </div>
    </div>
  );
}
