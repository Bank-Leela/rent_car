"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import {
  tripTemplateSchema,
  renameTripTemplateSchema,
  deleteTripTemplateSchema,
} from "@/lib/booking/schema";
import type { ActionResult } from "@/lib/booking/actions";

const NEW_BOOKING_PATH = "/requester/new";

// Save the current booking form (minus dates) as a named, reusable template.
export async function saveTripTemplateAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const te = await getTranslations("errors");

  const parsed = tripTemplateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: first?.path.join(".") };
  }

  await prisma.tripTemplate.create({
    data: { ...parsed.data, userId: session.user.id },
  });
  revalidatePath(NEW_BOOKING_PATH);
  return { ok: true };
}

// Rename a template the caller owns.
export async function renameTripTemplateAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const te = await getTranslations("errors");

  const parsed = renameTripTemplateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: first?.path.join(".") };
  }

  // Ownership gate: updateMany scoped by userId is a no-op for other users'
  // rows, so a forged id can't touch someone else's template.
  const { count } = await prisma.tripTemplate.updateMany({
    where: { id: parsed.data.id, userId: session.user.id },
    data: { name: parsed.data.name },
  });
  if (count === 0) return { ok: false, error: te("invalidInput") };

  revalidatePath(NEW_BOOKING_PATH);
  return { ok: true };
}

// Delete a template the caller owns.
export async function deleteTripTemplateAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const te = await getTranslations("errors");

  const parsed = deleteTripTemplateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: te("invalidInput") };

  await prisma.tripTemplate.deleteMany({
    where: { id: parsed.data.id, userId: session.user.id },
  });
  revalidatePath(NEW_BOOKING_PATH);
  return { ok: true };
}
