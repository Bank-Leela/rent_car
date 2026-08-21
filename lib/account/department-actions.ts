"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/booking/audit";
import { requireUser } from "@/lib/auth-helpers";
import type { ActionResult } from "@/lib/booking/actions";

const schema = z.object({ departmentId: z.string().min(1) });

/**
 * Self-service department change on /account. The new-booking form locks the
 * requesting department to this profile value, so this is where a requester
 * sets/changes it.
 */
export async function changeDepartmentAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const te = await getTranslations("errors");

  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: te("invalidInput"), field: "departmentId" };
  }
  const dept = await prisma.department.findUnique({
    where: { id: parsed.data.departmentId },
    select: { id: true },
  });
  if (!dept) {
    return { ok: false, error: te("invalidInput"), field: "departmentId" };
  }

  // Leave a trace. A booking snapshots the requester's department at create time,
  // and that snapshot decides which department the trip is billed to and whose
  // head can read the official PDF — so this self-service field is a real lever,
  // and it was being moved with nothing recorded anywhere.
  const before = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { departmentId: true },
  });
  if (before?.departmentId === dept.id) return { ok: true };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { departmentId: dept.id },
  });
  await logEvent({
    actorUserId: session.user.id,
    entityType: "USER",
    entityId: session.user.id,
    action: "DEPARTMENT_CHANGED",
    metadata: { from: before?.departmentId ?? null, to: dept.id },
  });
  revalidatePath("/account");
  revalidatePath("/requester/new");
  return { ok: true };
}
