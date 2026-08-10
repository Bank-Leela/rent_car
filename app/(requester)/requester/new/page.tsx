import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingForm, type BookingPrefill } from "@/components/forms/booking-form";
import { listDepartments } from "@/lib/departments";

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations("newBookingPage");
  const locale = await getLocale();
  const { from } = await searchParams;

  const departments = await listDepartments(locale);
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { departmentId: true, name: true, username: true, phone: true, email: true },
  });
  const templates = await prisma.tripTemplate.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  });

  // "Book again": pre-fill the trip fields from one of the requester's OWN past
  // bookings (scoped by requesterId — a foreign/unknown id silently no-ops).
  // Dates are never carried over.
  let prefill: BookingPrefill | null = null;
  let prefillLabel: string | undefined;
  if (from) {
    const src = await prisma.booking.findFirst({
      where: { id: from, requesterId: session.user.id },
    });
    if (src) {
      prefill = {
        purpose: src.purpose,
        destination: src.destination,
        googleMapsUrl: src.googleMapsUrl,
        pickupLocation: src.pickupLocation,
        pickupReturnTime: src.pickupReturnTime,
        waitingLocation: src.waitingLocation,
        ajarnName: src.ajarnName ?? "",
        ajarnPhone: src.ajarnPhone ?? "",
        ajarnEmail: src.ajarnEmail ?? "",
        coordinatorName: src.coordinatorName ?? "",
        coordinatorPhone: src.coordinatorPhone ?? "",
        maleCount: src.maleCount,
        femaleCount: src.femaleCount,
        passengerNotes: src.passengerNotes,
        passengerCount: src.passengerCount,
        travelWithinChula: src.travelWithinChula,
        outOfProvince: src.outOfProvince,
        isEmergency: src.isEmergency,
        returnTrip: src.returnTrip,
        waitAtDestination: src.waitAtDestination,
        preferredVehicleType: src.preferredVehicleType,
        needsOutsourcing: src.needsOutsourcing,
      };
      // Names the copied trip back to the requester by its ชื่อการจอง.
      prefillLabel = src.purpose;
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <BookingForm
        departments={departments}
        defaultDepartmentId={me?.departmentId ?? null}
        defaultAjarnName={me?.name || me?.username || ""}
        defaultAjarnPhone={me?.phone ?? ""}
        defaultAjarnEmail={me?.email ?? ""}
        templates={templates}
        prefill={prefill}
        prefillLabel={prefillLabel}
        locale={locale}
      />
    </div>
  );
}
