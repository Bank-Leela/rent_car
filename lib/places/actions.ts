"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { SavedPlace } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import type { ActionResult } from "@/lib/booking/actions";
import { createPlaceSchema, updatePlaceSchema, deletePlaceSchema } from "@/lib/places/schema";

export async function listMyPlaces(): Promise<SavedPlace[]> {
  const session = await requireUser();
  return prisma.savedPlace.findMany({
    where: { userId: session.user.id },
    orderBy: { label: "asc" },
  });
}

export async function createPlaceAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const te = await getTranslations("errors");
  const parsed = createPlaceSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: first?.path.join(".") };
  }
  await prisma.savedPlace.create({ data: { ...parsed.data, userId: session.user.id } });
  revalidatePath("/requester/places");
  revalidatePath("/requester/new");
  return { ok: true };
}

export async function updatePlaceAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const te = await getTranslations("errors");
  const parsed = updatePlaceSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: first?.path.join(".") };
  }
  const { id, ...rest } = parsed.data;
  // Ownership: scope the update by userId so a foreign id matches 0 rows.
  // Coerce the optional Maps link to null so clearing it on edit actually clears
  // the column — Prisma treats a `undefined` value as "leave column unchanged".
  const res = await prisma.savedPlace.updateMany({
    where: { id, userId: session.user.id },
    data: { ...rest, googleMapsUrl: rest.googleMapsUrl ?? null },
  });
  if (res.count === 0) return { ok: false, error: te("placeNotFound") };
  revalidatePath("/requester/places");
  revalidatePath("/requester/new");
  return { ok: true };
}

export async function deletePlaceAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const te = await getTranslations("errors");
  const parsed = deletePlaceSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: te("invalidInput") };
  const res = await prisma.savedPlace.deleteMany({
    where: { id: parsed.data.id, userId: session.user.id },
  });
  if (res.count === 0) return { ok: false, error: te("placeNotFound") };
  revalidatePath("/requester/places");
  revalidatePath("/requester/new");
  return { ok: true };
}
