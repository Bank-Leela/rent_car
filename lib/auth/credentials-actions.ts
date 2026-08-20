"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hash, compare } from "bcryptjs";
import { z } from "zod";
import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "@/auth";
import { requireUser, requireRole, homePathFor } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { checkLoginThrottle, recordLoginFailure } from "@/lib/login-throttle";
import { sendEmail } from "@/lib/email/client";
import type { Role } from "@prisma/client";

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

// ---- Public sign-in / sign-out ----

const signInSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function signInAction(formData: FormData): Promise<ActionResult> {
  const te = await getTranslations("errors");
  const parsed = signInSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: te("invalidInput") };
  }
  try {
    await nextAuthSignIn("credentials", {
      identifier: parsed.data.identifier,
      password: parsed.data.password,
      redirect: false,
    });
  } catch {
    return { ok: false, error: te("invalidCredentials") };
  }
  // After successful sign-in, redirect to role home.
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: parsed.data.identifier.toLowerCase() },
        { username: parsed.data.identifier.toLowerCase() },
      ],
    },
    include: { roles: true },
  });
  if (!user) return { ok: false, error: te("invalidCredentials") };
  redirect(homePathFor(user.roles.map((r) => r.role) as Role[]));
}

export async function signOutAction(): Promise<void> {
  await nextAuthSignOut({ redirect: false });
  redirect("/login");
}

// ---- Self-service: change own password ----

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const te = await getTranslations("errors");

  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: first?.path.join(".") };
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.passwordHash) {
    return { ok: false, error: te("invalidCredentials") };
  }
  const ok = await compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) {
    return { ok: false, field: "currentPassword", error: te("invalidCredentials") };
  }
  // Re-submitting the same password cleared mustChangePassword without rotating
  // anything, so the admin-issued initial password stayed live while the account
  // read as "has chosen their own".
  if (await compare(parsed.data.newPassword, user.passwordHash)) {
    return { ok: false, field: "newPassword", error: te("passwordMustDiffer") };
  }

  const newHash = await hash(parsed.data.newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash, mustChangePassword: false },
  });
  revalidatePath("/account");
  return { ok: true };
}

// ---- Self-service: change own username ----

const changeUsernameSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, "Letters, digits, dot, dash, or underscore only"),
});

export async function changeUsernameAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const te = await getTranslations("errors");

  const parsed = changeUsernameSchema.safeParse({ username: formData.get("username") });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: "username" };
  }
  const username = parsed.data.username.toLowerCase();

  // Enforce the one-change rule. If the row already has a
  // usernameChangedAt, refuse — only an admin can change the username
  // from /admin/users at this point.
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { username: true, usernameChangedAt: true },
  });
  if (me.usernameChangedAt) {
    return { ok: false, field: "username", error: te("usernameAlreadyChanged") };
  }
  // No-op short-circuit so a user re-saving the same value doesn't burn
  // their one change.
  if (me.username === username) {
    return { ok: true };
  }

  const taken = await prisma.user.findFirst({
    where: { username, NOT: { id: session.user.id } },
    select: { id: true },
  });
  if (taken) {
    return { ok: false, field: "username", error: te("usernameTaken") };
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { username, usernameChangedAt: new Date() },
  });
  revalidatePath("/account");
  return { ok: true };
}

// ---- Department (หน่วยงานผู้ขอใช้รถ) ----
// The booking form shows the department read-only; the account page is the
// one place a user changes it themselves.

export async function changeDepartmentAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const te = await getTranslations("errors");

  const departmentId = String(formData.get("departmentId") ?? "").trim();
  if (!departmentId) {
    return { ok: false, error: te("invalidInput"), field: "departmentId" };
  }
  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true },
  });
  if (!department) {
    return { ok: false, error: te("invalidInput"), field: "departmentId" };
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { departmentId },
  });
  revalidatePath("/account");
  return { ok: true };
}

// ---- Forgot password: request reset email ----

const requestResetSchema = z.object({
  email: z.string().trim().email(),
});

export async function requestPasswordResetAction(formData: FormData): Promise<ActionResult> {
  const te = await getTranslations("errors");
  const tEmail = await getTranslations("emails.passwordReset");

  const parsed = requestResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, error: te("invalidInput") };
  }
  const email = parsed.data.email.toLowerCase();

  // Unauthenticated and unthrottled, this action would send unlimited reset mail
  // to any address someone knows — a mail-bomb aimed at one person, and a way to
  // burn the SMTP quota the rest of the app needs. Reuse the sign-in limiter.
  // Every outcome still returns ok:true so the anti-probing property below holds:
  // a throttled caller and an unknown address are indistinguishable.
  const throttleKeys = [`reset:${email}`];
  if (checkLoginThrottle(throttleKeys).blocked) return { ok: true };
  recordLoginFailure(throttleKeys);

  const user = await prisma.user.findUnique({ where: { email } });
  // Always return ok=true so the form can't be used to probe whether an
  // email is registered. We only actually send when the user exists.
  if (!user || !user.isActive) return { ok: true };

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  // Reuse the already-documented deploy vars so a prod reset link isn't localhost
  // when PUBLIC_BASE_URL is unset (deployment.md §3 sets APP_URL + NEXTAUTH_URL).
  const base =
    process.env.PUBLIC_BASE_URL ??
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  const link = `${base}/reset/${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: tEmail("subject"),
    text: tEmail("text", { link }),
    html: `<p>${tEmail("html", { link, linkOpen: `<a href="${link}">`, linkClose: "</a>" })}</p>`,
  });
  return { ok: true };
}

// ---- Reset password using a token ----

const resetWithTokenSchema = z
  .object({
    token: z.string().min(10),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export async function resetPasswordWithTokenAction(formData: FormData): Promise<ActionResult> {
  const te = await getTranslations("errors");
  const parsed = resetWithTokenSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: first?.path.join(".") };
  }
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    return { ok: false, error: te("resetTokenInvalid") };
  }
  const newHash = await hash(parsed.data.newPassword, BCRYPT_ROUNDS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash: newHash, mustChangePassword: false },
    });
    await tx.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
  });
  return { ok: true };
}

// ---- Admin: create / reset / toggle user accounts ----

const createUserSchema = z.object({
  email: z.string().trim().email(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/),
  name: z.string().trim().min(2),
  thaiName: z.string().trim().optional().or(z.literal("")).transform((v) => v || undefined),
  departmentId: z.string().optional().or(z.literal("")).transform((v) => v || undefined),
  initialPassword: z.string().min(8),
  roles: z
    .string()
    .min(1)
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
});

const VALID_ROLES: ReadonlyArray<Role> = ["REQUESTER", "ADMIN", "DRIVER"];

export async function adminCreateUserAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const parsed = createUserSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: first?.path.join(".") };
  }
  const data = parsed.data;
  const email = data.email.toLowerCase();
  const username = data.username.toLowerCase();
  const roles = data.roles.filter((r): r is Role => (VALID_ROLES as readonly string[]).includes(r));
  if (roles.length === 0) return { ok: false, field: "roles", error: te("pickAtLeastOneRole") };

  const dup = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { id: true },
  });
  if (dup) return { ok: false, error: te("emailOrUsernameTaken") };

  const passwordHash = await hash(data.initialPassword, BCRYPT_ROUNDS);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        username,
        name: data.name,
        thaiName: data.thaiName,
        departmentId: data.departmentId,
        passwordHash,
        mustChangePassword: true,
      },
    });
    for (const role of roles) {
      await tx.userRole.create({ data: { userId: user.id, role } });
    }
  });
  revalidatePath("/admin/users");
  return { ok: true };
}

const adminResetSchema = z.object({
  userId: z.string().min(1),
  initialPassword: z.string().min(8),
});

export async function adminResetPasswordAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const parsed = adminResetSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) return { ok: false, error: te("userNotFound") };
  const passwordHash = await hash(parsed.data.initialPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: true },
  });
  revalidatePath("/admin/users");
  return { ok: true };
}

async function isAdminUser(userId: string): Promise<boolean> {
  return (
    (await prisma.userRole.count({ where: { userId, role: "ADMIN" } })) > 0
  );
}

const toggleActiveSchema = z.object({
  userId: z.string().min(1),
});

export async function adminToggleActiveAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const te = await getTranslations("errors");
  const parsed = toggleActiveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) return { ok: false, error: te("userNotFound") };
  // Deactivating is a one-way door from inside the app: a disabled account cannot
  // sign in, and only an ADMIN can re-enable one. So the two moves that leave
  // nobody able to undo them are refused here — locking yourself out, and removing
  // the last admin. Recovering from either needs direct database access, which is
  // not something the office has.
  if (user.isActive) {
    if (user.id === session.user.id) {
      return { ok: false, error: te("cannotDeactivateSelf") };
    }
    const otherAdmins = await prisma.user.count({
      where: {
        id: { not: user.id },
        isActive: true,
        roles: { some: { role: "ADMIN" } },
      },
    });
    if (otherAdmins === 0 && (await isAdminUser(user.id))) {
      return { ok: false, error: te("cannotDeactivateLastAdmin") };
    }
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { isActive: !user.isActive },
  });
  revalidatePath("/admin/users");
  return { ok: true };
}
