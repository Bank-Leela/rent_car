import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { listMyPlaces } from "@/lib/places/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlacesManager } from "@/components/forms/places-manager";

export default async function SavedPlacesPage() {
  await requireRole("REQUESTER");
  const t = await getTranslations("places");
  const places = await listMyPlaces();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlacesManager
            places={places.map((p) => ({
              id: p.id,
              label: p.label,
              destination: p.destination,
              province: p.province,
              googleMapsUrl: p.googleMapsUrl,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
