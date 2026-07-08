"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { isMapsConfigured, getDrivingDistanceKm } from "@/lib/maps/distance";
import type { ActionResult } from "@/lib/booking/actions";

// Admin-triggered: auto-fill a booking's estimatedDistance from Google Maps
// before deciding (drives the >400 km co-driver call). Gated on the key.
export async function estimateDistanceAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return { ok: false, error: te("invalidInput") };
  if (!isMapsConfigured()) return { ok: false, error: "mapsNotConfigured" };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { destination: true, province: true },
  });
  if (!booking) return { ok: false, error: te("bookingNotFound") };

  let km: number | null;
  try {
    km = await getDrivingDistanceKm(booking.destination, booking.province);
  } catch (err) {
    console.error("[maps] distance lookup failed", err);
    return { ok: false, error: "mapsLookupFailed" };
  }
  if (km == null) return { ok: false, error: "mapsNoRoute" };

  await prisma.booking.update({ where: { id: bookingId }, data: { estimatedDistance: km } });
  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}
