# Admin Driver Management — Design

**Date:** 2026-06-30
**Status:** Approved (verbal), implementing.

## Goal

Give admins a dedicated section to view a driver roster and edit a single driver's
**information** and **credentials**, following the reference roster spreadsheet
(ชื่อ-สกุล, ชื่อเล่น, เบอร์โทร, ใบขับขี่หมดอายุ, รถประจำ, ตำแหน่ง, เกษียณ, หมายเหตุ).

## Scope decisions

- **Field scope:** full spreadsheet → adds new optional `Driver` columns.
- **Location:** new `/admin/drivers` section (roster list → per-driver edit page).
- **Assigned vehicle:** editable here (the roster lists รถประจำ). Reassigning sets
  `Vehicle.assignedDriverId` (car=driver 1:1). Flagged as scheduling-sensitive.
- **Out of scope:** *creating* drivers (use existing `/admin/users` create + role
  assignment). This section edits existing drivers only.
- Credentials password reset **reuses** existing `adminResetPasswordAction`
  (`lib/auth/credentials-actions.ts`); we do not modify `lib/auth/*`.

## Schema (one additive migration)

```prisma
model Driver {
  // ...existing: pool, licenseNumber, licenseExpiresAt, isActive, rotation stamps
  nickname        String?            // ชื่อเล่น
  position        String?            // ตำแหน่ง (free text, e.g. ลูกจ้างประจำ)
  retirementYear  Int?               // เกษียณ — Thai BE year as shown (e.g. 2569)
  notes           String?  @db.Text  // หมายเหตุ
  licenseType     String?            // ใบขับขี่ "ประเภท 2"
}
```

Name / thaiName / phone / username / passwordHash stay on `User` (unchanged schema).

Migration created with `prisma migrate dev --name add_driver_roster_fields --create-only`
then applied with `prisma migrate deploy` (local interactive `migrate dev` is blocked),
followed by `prisma generate`.

## Components / pages

- `app/(admin)/admin/drivers/page.tsx` — server: fetch `Driver` + `user` +
  `assignedVehicle`, map to rows, render `DriversListClient`.
- `app/(admin)/admin/drivers/loading.tsx` — skeleton (match other admin pages).
- `app/(admin)/admin/drivers/[id]/page.tsx` — server: fetch one driver (+ user, +
  vehicles for the assign select), render `DriverEditForm` (Information card) +
  `DriverCredentials` (Credentials card).
- `components/admin/drivers-list-client.tsx` — `ListSearch` over rows
  (keys: name, nickname, phone); row → name · nickname · phone · vehicle · active,
  links to `/admin/drivers/[id]`.
- `components/forms/driver-edit-form.tsx` — client form posting
  `adminUpdateDriverAction`; fields: name, thaiName, nickname, phone, licenseType,
  licenseNumber, licenseExpiresAt (date), assigned vehicle (`SearchableSelect`),
  position, retirementYear (number), notes (textarea), isActive (toggle).
  `useActionToast` for feedback.
- `components/forms/driver-credentials.tsx` — username field →
  `adminSetDriverUsernameAction`; password reset reusing `adminResetPasswordAction`
  + `PasswordInput`.

## Server actions — `lib/admin/driver-actions.ts` (new; not `lib/auth`)

- `adminUpdateDriverAction(formData)` — `requireRole("ADMIN")`; zod-validate;
  transaction: update `User`(name, thaiName, phone) + `Driver`(nickname, position,
  retirementYear, notes, licenseType, licenseNumber, licenseExpiresAt, isActive);
  reassign `Vehicle.assignedDriverId` (clear the previous holder of the chosen
  vehicle; clear this driver's old vehicle). `revalidatePath` drivers + schedule.
- `adminSetDriverUsernameAction(formData)` — `requireRole("ADMIN")`; trim/validate
  (3–40, `[a-z0-9._]`); uniqueness check (exclude self); set `User.username`.
  Admin change bypasses the self-service once-limit.
- Return shape: `{ ok: true } | { ok: false, error: string }` (i18n error keys),
  matching existing admin actions.

## Nav + i18n

- Add `{ href: "/admin/drivers", label: t("drivers") }` to the admin nav
  (`app/(admin)/layout.tsx`), `nav.drivers` key (en/th).
- New `adminDrivers` namespace (en + th parity): titles, field labels, buttons,
  toasts, error keys, empty state.

## Error handling

- Invalid input → zod → `{ ok:false, error:"invalidInput" }`.
- Username taken → `{ ok:false, error:"usernameTaken" }`.
- Chosen vehicle already held by another active driver → reassign (move it) — allowed,
  the prior holder's `assignedDriverId` is cleared in the same transaction.
- Driver not found → 404 (`notFound()`), like other `[id]` pages.

## Verification

- `prisma migrate` (create + deploy) + `prisma generate`.
- `npm run typecheck && npm test`.
- Live: `/admin/drivers` lists, edit a driver saves + persists, username change,
  password reset, vehicle reassign reflected on the schedule.
- Adversarial review workflow: authz, i18n parity (no MISSING_MESSAGE), migration
  safety, vehicle-reassignment scheduling impact, form/validation correctness, a11y.
```
