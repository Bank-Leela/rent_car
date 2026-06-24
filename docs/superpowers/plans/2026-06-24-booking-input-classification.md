# Booking Input & Classification (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three requester-facing booking-input features — a stored Google-Maps link (required), a per-requester private saved-places feature, and clearer in-Chula framing — without touching the matcher/classifier.

**Architecture:** Reuse the existing `Booking.outsideChula` bit (no new in-Chula column). Add one scalar `Booking.googleMapsUrl` and a new `SavedPlace` model owned by `User`. A booking copies place values at submit time (no FK), so deleting a place never affects past bookings. Saved-place CRUD lives in a new `lib/places/*` module with server-side ownership checks; the booking form gains a Maps-link input, a searchable autofill combobox, and an inline "save destination" control.

**Tech Stack:** Next.js (app router, this fork — `params`/`searchParams` are Promises), Prisma + Postgres, zod, next-intl, React 19, Tailwind/shadcn primitives, vitest.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-06-24-booking-input-classification-design.md`.
- **Matcher / WERN / priority / classifier stay UNCHANGED.** Do not edit `lib/booking/classification.ts` or any scheduling solver/matcher file. (`scheduler-board-blocks.tsx` gets presentation-only chips — see Task 9; read `docs/scheduling-algorithm.md` first per AGENTS.md.)
- Maps link: zod `.url()`, **any host** (so `maps.app.goo.gl` works) — do NOT restrict to google.com. No distance is computed from it.
- Maps link is **required for new normal bookings** (the requester `createBookingAction` path). The admin instant-booking path (sub-project B) is out of scope.
- Saved places are **private per requester**; ownership enforced server-side on every read/write.
- Autofill is a one-way copy: editing a booking never mutates a place; editing/deleting a place never mutates past bookings.
- Recurrence children copy `googleMapsUrl` and `outsideChula` from the parent.
- Verify after `.ts`/`.tsx`: `npm run typecheck`. Booking tests run serial: `npx vitest run --no-file-parallelism`. Integration tests need a seeded dev DB.
- Every new user-facing string gets an `en.json` AND a `th.json` key.

---

### Task 1: Schema — `Booking.googleMapsUrl`, `SavedPlace`, `User.savedPlaces`

**Files:**
- Modify: `prisma/schema.prisma` (Booking model ~L385; User model ~L216; new model after Booking)
- Migration: `prisma/migrations/<ts>_add_saved_places_and_maps_url/`

**Interfaces:**
- Produces: `Booking.googleMapsUrl: String?`; `model SavedPlace { id, userId, label, destination, province, googleMapsUrl?, createdAt, updatedAt }`; `User.savedPlaces: SavedPlace[]`.

- [ ] **Step 1: Add `googleMapsUrl` to Booking** — after `estimatedDistance Int?` (schema.prisma):

```prisma
  estimatedDistance Int?
  // Sub-project A: stored Google-Maps link for the route. Attached by the
  // requester; never auto-pulled for distance (auto-pull costs money).
  googleMapsUrl     String?
```

- [ ] **Step 2: Add the back-relation to User** — in the `User` relation block (after `bookings Booking[] @relation("BookingRequester")`):

```prisma
  bookings            Booking[]      @relation("BookingRequester")
  savedPlaces         SavedPlace[]
```

- [ ] **Step 3: Add the `SavedPlace` model** — after the `Booking` model:

```prisma
// Sub-project A: a requester's private, reusable destination. Autofills the
// booking form. No FK from Booking — a booking copies these values at submit
// time, so deleting a place never affects past bookings.
model SavedPlace {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  label         String
  destination   String
  province      String
  googleMapsUrl String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([userId])
}
```

- [ ] **Step 4: Create + apply the migration** (DB must be running):

Run: `npx prisma migrate dev --name add_saved_places_and_maps_url`
Expected: migration created, applied, `prisma generate` runs. If DB unreachable, surface to user — do NOT `migrate reset`.

- [ ] **Step 5: Typecheck (client regenerated)**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit** — `feat(booking): schema for stored Maps link + per-requester saved places`

---

### Task 2: zod — `googleMapsUrl` on `newBookingSchema` + place schemas

**Files:**
- Modify: `lib/booking/schema.ts`
- Create: `lib/places/schema.ts`
- Test: `lib/booking/schema.test.ts` (extend), `lib/places/schema.test.ts` (new)

**Interfaces:**
- Produces: `newBookingSchema` now requires `googleMapsUrl: string` (valid URL). `lib/places/schema.ts` exports `createPlaceSchema`, `updatePlaceSchema`, `deletePlaceSchema` and `NewPlaceInput`.

- [ ] **Step 1: Failing test — booking schema requires a valid Maps URL.** Add to `lib/booking/schema.test.ts`: first extend `baseInput` with `googleMapsUrl: "https://maps.app.goo.gl/abc123"`, then add:

```ts
  it("accepts a shortened (non-google.com) Maps URL", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, googleMapsUrl: "https://maps.app.goo.gl/xyz" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty Maps URL", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, googleMapsUrl: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join("."))).toContain("googleMapsUrl");
    }
  });

  it("rejects a non-URL Maps value", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, googleMapsUrl: "not a url" });
    expect(result.success).toBe(false);
  });
```

- [ ] **Step 2: Run — expect FAIL** (`googleMapsUrl` not in schema yet).

Run: `npx vitest run lib/booking/schema.test.ts --no-file-parallelism`

- [ ] **Step 3: Add `googleMapsUrl` to `newBookingSchema`** — after the `province` field:

```ts
    province: z.string().min(2, "Required"),
    // Sub-project A: stored Maps link. Required on the requester flow; any host
    // (so maps.app.goo.gl / goo.gl/maps shortened links work). No distance pull.
    googleMapsUrl: z.string().trim().url("Add a valid Google Maps link"),
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npx vitest run lib/booking/schema.test.ts --no-file-parallelism`

- [ ] **Step 5: Create `lib/places/schema.ts`:**

```ts
import { z } from "zod";

const labelField = z.string().trim().min(1, "Name this place").max(100);
const destinationField = z.string().trim().min(2, "Required").max(300);
const provinceField = z.string().trim().min(2, "Required").max(100);
// Optional on a place: a place can be saved before its Maps link is known.
const mapsField = z
  .string()
  .trim()
  .url("Add a valid Google Maps link")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

export const createPlaceSchema = z.object({
  label: labelField,
  destination: destinationField,
  province: provinceField,
  googleMapsUrl: mapsField,
});

export const updatePlaceSchema = createPlaceSchema.extend({
  id: z.string().min(1),
});

export const deletePlaceSchema = z.object({ id: z.string().min(1) });

export type NewPlaceInput = z.infer<typeof createPlaceSchema>;
```

- [ ] **Step 6: Create `lib/places/schema.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import { createPlaceSchema } from "./schema";

describe("createPlaceSchema", () => {
  it("accepts a place without a maps link", () => {
    const r = createPlaceSchema.safeParse({ label: "MOU uni", destination: "X Uni", province: "Bangkok" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.googleMapsUrl).toBeUndefined();
  });

  it("accepts a place with a shortened maps link", () => {
    const r = createPlaceSchema.safeParse({ label: "X", destination: "X Uni", province: "Bangkok", googleMapsUrl: "https://maps.app.goo.gl/x" });
    expect(r.success).toBe(true);
  });

  it("rejects a blank label", () => {
    const r = createPlaceSchema.safeParse({ label: "  ", destination: "X Uni", province: "Bangkok" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-URL maps link", () => {
    const r = createPlaceSchema.safeParse({ label: "X", destination: "X Uni", province: "Bangkok", googleMapsUrl: "nope" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 7: Run — expect PASS.**

Run: `npx vitest run lib/places/schema.test.ts --no-file-parallelism`

- [ ] **Step 8: Commit** — `feat(booking): require Maps link on new bookings + saved-place zod schemas`

---

### Task 3: Persist `googleMapsUrl` in `createBookingAction` (parent + recurrence)

**Files:**
- Modify: `lib/booking/actions.ts` (parent `create` ~L143; child `create` ~L218)
- Test: `lib/booking/actions.test.ts` (extend) — fix existing payloads (schema now requires the URL)

**Interfaces:**
- Consumes: `newBookingSchema` (now has `googleMapsUrl`).
- Produces: created/child bookings carry `googleMapsUrl`.

- [ ] **Step 1: Update existing test payloads.** In `lib/booking/actions.test.ts`, add `googleMapsUrl: "https://maps.app.goo.gl/smoke"` to **all four** `formDataFor({...})` payloads (so they still parse). Then add to the first test's assertions:

```ts
    expect(booking.googleMapsUrl).toBe("https://maps.app.goo.gl/smoke");
```

- [ ] **Step 2: Run — expect FAIL** (action doesn't persist `googleMapsUrl` yet).

Run: `npx vitest run lib/booking/actions.test.ts --no-file-parallelism`
(Requires seeded dev DB.)

- [ ] **Step 3: Persist on the parent** — in the parent `tx.booking.create` data, after `province: data.province,`:

```ts
        province: data.province,
        googleMapsUrl: data.googleMapsUrl,
```

- [ ] **Step 4: Persist on recurrence children** — in the child `tx.booking.create` data, after `province: data.province,`:

```ts
        province: data.province,
        googleMapsUrl: data.googleMapsUrl,
```

- [ ] **Step 5: Run — expect PASS.**

Run: `npx vitest run lib/booking/actions.test.ts --no-file-parallelism`

- [ ] **Step 6: Commit** — `feat(booking): persist stored Maps link on create + recurrence`

---

### Task 4: Saved-place server actions (ownership-enforced)

**Files:**
- Create: `lib/places/actions.ts`
- Test: `lib/places/actions.test.ts` (integration, DB-seeded)

**Interfaces:**
- Consumes: `createPlaceSchema`, `updatePlaceSchema`, `deletePlaceSchema`; `requireUser`; `ActionResult` from `@/lib/booking/actions`.
- Produces: `listMyPlaces(): Promise<SavedPlace[]>`; `createPlaceAction(FormData): Promise<ActionResult>`; `updatePlaceAction(FormData): Promise<ActionResult>`; `deletePlaceAction(FormData): Promise<ActionResult>`. All scoped to the caller; update/delete return `{ ok:false, error: te("placeNotFound") }` when the row isn't the caller's.

- [ ] **Step 1: Write `lib/places/actions.ts`:**

```ts
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
  const res = await prisma.savedPlace.updateMany({
    where: { id, userId: session.user.id },
    data: rest,
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
```

- [ ] **Step 2: Add the `placeNotFound` error key** — `messages/en.json` `errors`: `"placeNotFound": "Saved place not found."`; `messages/th.json` `errors`: `"placeNotFound": "ไม่พบสถานที่ที่บันทึกไว้"`.

- [ ] **Step 3: Write `lib/places/actions.test.ts`** (ownership — user A cannot update/delete user B's place). Mirrors `actions.test.ts` mocking; the session mock is mutable so we can switch caller:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let CURRENT_USER = "seed-user-requester";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: CURRENT_USER, roles: ["REQUESTER"] } })),
}));

import { prisma } from "@/lib/db";
import { createPlaceAction, updatePlaceAction, deletePlaceAction, listMyPlaces } from "@/lib/places/actions";

const USER_A = "seed-user-requester";
const USER_B = "seed-user-approver";
const created: string[] = [];

function fd(input: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(input)) f.append(k, v);
  return f;
}

beforeAll(async () => {
  for (const id of [USER_A, USER_B]) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) throw new Error(`Seed user ${id} missing — run npx prisma db seed`);
  }
  await prisma.savedPlace.deleteMany({ where: { userId: { in: [USER_A, USER_B] }, label: { startsWith: "TEST_" } } });
});

afterAll(async () => {
  await prisma.savedPlace.deleteMany({ where: { id: { in: created } } });
  await prisma.savedPlace.deleteMany({ where: { label: { startsWith: "TEST_" } } });
  await prisma.$disconnect();
});

describe("saved-place ownership", () => {
  it("creates a place for the caller and lists only theirs", async () => {
    CURRENT_USER = USER_A;
    const res = await createPlaceAction(fd({ label: "TEST_A", destination: "A Uni", province: "Bangkok" }));
    expect(res.ok).toBe(true);
    const mine = await listMyPlaces();
    const row = mine.find((p) => p.label === "TEST_A");
    expect(row).toBeTruthy();
    created.push(row!.id);

    CURRENT_USER = USER_B;
    const theirs = await listMyPlaces();
    expect(theirs.find((p) => p.label === "TEST_A")).toBeUndefined();
  });

  it("forbids user B from updating user A's place", async () => {
    CURRENT_USER = USER_A;
    await createPlaceAction(fd({ label: "TEST_A2", destination: "A2", province: "Bangkok" }));
    const row = (await listMyPlaces()).find((p) => p.label === "TEST_A2")!;
    created.push(row.id);

    CURRENT_USER = USER_B;
    const res = await updatePlaceAction(fd({ id: row.id, label: "HACK", destination: "X", province: "Y" }));
    expect(res.ok).toBe(false);
    const fresh = await prisma.savedPlace.findUnique({ where: { id: row.id } });
    expect(fresh!.label).toBe("TEST_A2");
  });

  it("forbids user B from deleting user A's place", async () => {
    CURRENT_USER = USER_A;
    await createPlaceAction(fd({ label: "TEST_A3", destination: "A3", province: "Bangkok" }));
    const row = (await listMyPlaces()).find((p) => p.label === "TEST_A3")!;
    created.push(row.id);

    CURRENT_USER = USER_B;
    const res = await deletePlaceAction(fd({ id: row.id }));
    expect(res.ok).toBe(false);
    expect(await prisma.savedPlace.findUnique({ where: { id: row.id } })).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run — expect PASS** (seeded DB).

Run: `npx vitest run lib/places/actions.test.ts --no-file-parallelism`

- [ ] **Step 5: Commit** — `feat(places): ownership-enforced saved-place CRUD actions`

---

### Task 5: i18n keys (en + th) for all new UI strings

**Files:**
- Modify: `messages/en.json`, `messages/th.json`

**Interfaces:**
- Produces: keys consumed by Tasks 6–9. `bookingForm.{mapsLinkLabel,mapsLinkHelper,mapsLinkInvalid,savedPlaceLabel,savedPlacePlaceholder,savedPlaceNone,savePlaceCta,savePlaceNamePlaceholder,savePlaceSaved,managePlacesLink}`; `nav.places`; `places.*` (page); `bookingDetail.mapsLink`; chips `common.{inChula,outsideChula}`.

- [ ] **Step 1: Add `bookingForm` keys** (en) after `destinationMapsLink`:

```json
    "mapsLinkLabel": "Google Maps link",
    "mapsLinkHelper": "Paste a Maps link for the destination (any Maps share link works).",
    "savedPlaceLabel": "Use a saved place",
    "savedPlacePlaceholder": "Pick a saved place…",
    "savedPlaceNone": "No saved place",
    "savePlaceCta": "★ Save this destination",
    "savePlaceNamePlaceholder": "Name this place, e.g. MOU partner uni",
    "savePlaceSaved": "Saved",
    "managePlacesLink": "Manage saved places →",
```

- [ ] **Step 2: Add `nav.places`** (en, in `nav`): `"places": "Saved places"`.

- [ ] **Step 3: Add `common` chips** (en, in `common`): `"inChula": "In Chula"`, `"outsideChula": "Outside Chula"`.

- [ ] **Step 4: Add `bookingDetail.mapsLink`** (en): `"mapsLink": "Google Maps"`.

- [ ] **Step 5: Add a `places` section** (en, top-level):

```json
  "places": {
    "title": "Saved places",
    "subtitle": "Destinations you reuse. Private to you; used to autofill the booking form.",
    "addTitle": "Add a place",
    "label": "Name",
    "destination": "Destination",
    "province": "Province",
    "mapsLink": "Google Maps link (optional)",
    "save": "Save place",
    "saving": "Saving…",
    "edit": "Edit",
    "delete": "Delete",
    "cancel": "Cancel",
    "update": "Update",
    "empty": "No saved places yet. Add one below.",
    "deleteConfirm": "Delete this saved place?"
  },
```

- [ ] **Step 6: Mirror every key in `th.json`** (same paths). Thai copy:
  - `bookingForm`: `mapsLinkLabel`:"ลิงก์ Google Maps", `mapsLinkHelper`:"วางลิงก์ Maps ของปลายทาง (ใช้ลิงก์แชร์ Maps แบบใดก็ได้)", `savedPlaceLabel`:"ใช้สถานที่ที่บันทึกไว้", `savedPlacePlaceholder`:"เลือกสถานที่ที่บันทึกไว้…", `savedPlaceNone`:"ไม่ใช้สถานที่ที่บันทึก", `savePlaceCta`:"★ บันทึกปลายทางนี้", `savePlaceNamePlaceholder`:"ตั้งชื่อสถานที่ เช่น มหาวิทยาลัยคู่ MOU", `savePlaceSaved`:"บันทึกแล้ว", `managePlacesLink`:"จัดการสถานที่ที่บันทึกไว้ →"
  - `nav.places`:"สถานที่ที่บันทึก"
  - `common.inChula`:"ในจุฬาฯ", `common.outsideChula`:"นอกจุฬาฯ"
  - `bookingDetail.mapsLink`:"Google Maps"
  - `places`: `title`:"สถานที่ที่บันทึกไว้", `subtitle`:"ปลายทางที่คุณใช้บ่อย เป็นข้อมูลส่วนตัวของคุณ ใช้กรอกฟอร์มจองอัตโนมัติ", `addTitle`:"เพิ่มสถานที่", `label`:"ชื่อ", `destination`:"ปลายทาง", `province`:"จังหวัด", `mapsLink`:"ลิงก์ Google Maps (ไม่บังคับ)", `save`:"บันทึกสถานที่", `saving`:"กำลังบันทึก…", `edit`:"แก้ไข", `delete`:"ลบ", `cancel`:"ยกเลิก", `update`:"อัปเดต", `empty`:"ยังไม่มีสถานที่ที่บันทึก เพิ่มด้านล่าง", `deleteConfirm`:"ลบสถานที่ที่บันทึกนี้หรือไม่?"

- [ ] **Step 7: Validate JSON parses** — `npm run typecheck` (next-intl type-checks message access) or `node -e "JSON.parse(require('fs').readFileSync('messages/en.json'));JSON.parse(require('fs').readFileSync('messages/th.json'))"`.

- [ ] **Step 8: Commit** — `i18n(places): en+th strings for Maps link, saved places, in-Chula chips`

---

### Task 6: Booking form — Maps input, autofill combobox, inline save, label

**Files:**
- Modify: `components/forms/booking-form.tsx`
- Modify: `app/(requester)/requester/new/page.tsx` (load `listMyPlaces`, pass to form)

**Interfaces:**
- Consumes: `listMyPlaces`, `createPlaceAction`, `SearchableSelect`, new `bookingForm.*` keys.
- Produces: `BookingForm` gains a `places: BookingFormPlace[]` prop where `BookingFormPlace = { id; label; destination; province; googleMapsUrl: string | null }`.

- [ ] **Step 1: Add the prop type + controlled state.** In `booking-form.tsx`: add `export type BookingFormPlace = { id: string; label: string; destination: string; province: string; googleMapsUrl: string | null };`, add `places` to the component props, and convert `destination` + `googleMapsUrl` to controlled state:

```tsx
  const [destination, setDestination] = useState<string>("");
  const [mapsUrl, setMapsUrl] = useState<string>("");
```

- [ ] **Step 2: Autofill from a saved place.** Above the destination field, render the combobox (only when `places.length > 0`):

```tsx
            {places.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="savedPlace">{t("savedPlaceLabel")}</Label>
                <SearchableSelect
                  id="savedPlace"
                  name="savedPlace"
                  placeholder={t("savedPlacePlaceholder")}
                  options={places.map((p) => ({ value: p.id, label: p.label }))}
                  onChange={(id) => {
                    const p = places.find((x) => x.id === id);
                    if (!p) return;
                    setDestination(p.destination);
                    setProvince(p.province);
                    setMapsUrl(p.googleMapsUrl ?? "");
                  }}
                />
              </div>
            )}
```

(Import `SearchableSelect` from `@/components/ui/searchable-select`; the hidden `savedPlace` input is ignored server-side — zod strips unknown keys.)

- [ ] **Step 3: Make destination controlled** — replace the destination `<Input>` with `value={destination} onChange={(e) => setDestination(e.target.value)}`.

- [ ] **Step 4: Add the Maps-link input** (required) under the destination Maps button:

```tsx
            <div className="grid gap-2">
              <ReqLabel htmlFor="googleMapsUrl">{t("mapsLinkLabel")}</ReqLabel>
              <Input
                id="googleMapsUrl"
                name="googleMapsUrl"
                type="url"
                inputMode="url"
                required
                value={mapsUrl}
                onChange={(e) => setMapsUrl(e.target.value)}
                placeholder="https://maps.app.goo.gl/…"
              />
              <span className="text-xs text-muted-foreground">{t("mapsLinkHelper")}</span>
            </div>
```

- [ ] **Step 5: Open the stored link when present.** Update `openDestinationInMaps` to prefer the typed Maps URL:

```tsx
  const openDestinationInMaps = () => {
    const stored = mapsUrl.trim();
    if (stored) {
      window.open(stored, "_blank", "noopener,noreferrer");
      return;
    }
    const dest = destination.trim();
    const url = dest
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`
      : "https://www.google.com/maps";
    window.open(url, "_blank", "noopener,noreferrer");
  };
```

- [ ] **Step 6: Inline "save this destination".** Below the Maps input, an expandable label box + a server-action save:

```tsx
            <SaveDestination destination={destination} province={province} mapsUrl={mapsUrl} />
```

Add the component (uses `createPlaceAction` + `useTransition`):

```tsx
function SaveDestination({ destination, province, mapsUrl }: { destination: string; province: string; mapsUrl: string }) {
  const t = useTranslations("bookingForm");
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const canSave = destination.trim().length >= 2 && province.trim().length >= 2 && label.trim().length >= 1;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline">
        {t("savePlaceCta")}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("savePlaceNamePlaceholder")} className="h-9 max-w-xs" />
      <Button type="button" size="sm" disabled={!canSave || pending} onClick={() => {
        const f = new FormData();
        f.append("label", label.trim());
        f.append("destination", destination.trim());
        f.append("province", province.trim());
        if (mapsUrl.trim()) f.append("googleMapsUrl", mapsUrl.trim());
        start(async () => {
          const res = await createPlaceAction(f);
          if (res.ok) { setSaved(true); setOpen(false); setLabel(""); }
        });
      }}>
        {t("savePlaceSaved" )}
      </Button>
      {saved && <span className="text-xs text-muted-foreground">{t("savePlaceSaved")}</span>}
    </div>
  );
}
```

(Import `createPlaceAction` from `@/lib/places/actions`. `Button` already supports a `size` prop — confirm; if not, drop `size="sm"` and use className.)

- [ ] **Step 7: Add `googleMapsUrl` to `baseRequired`** so the in-form pre-validation flags an empty link:

```tsx
    { name: "destination", labelKey: "destination" },
    { name: "googleMapsUrl", labelKey: "mapsLinkLabel" },
```

- [ ] **Step 8: Wire `new/page.tsx`.** Read it first; add `const places = await listMyPlaces();` and pass `places={places.map((p) => ({ id: p.id, label: p.label, destination: p.destination, province: p.province, googleMapsUrl: p.googleMapsUrl }))}` to `<BookingForm>`. Add a "Manage saved places" link near the form (`<Link href="/requester/places">{t("managePlacesLink")}</Link>`).

- [ ] **Step 9: Typecheck.**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit** — `feat(booking-form): Maps-link input + saved-place autofill + inline save`

---

### Task 7: Saved-places management page + nav link

**Files:**
- Create: `app/(requester)/requester/places/page.tsx` (server component)
- Create: `components/forms/places-manager.tsx` (client)
- Modify: `app/(requester)/layout.tsx` (nav link)

**Interfaces:**
- Consumes: `listMyPlaces`, `createPlaceAction`, `updatePlaceAction`, `deletePlaceAction`, `places.*` keys.

- [ ] **Step 1: `app/(requester)/requester/places/page.tsx`:**

```tsx
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
              id: p.id, label: p.label, destination: p.destination,
              province: p.province, googleMapsUrl: p.googleMapsUrl,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: `components/forms/places-manager.tsx`** — list with edit/delete + an add form, all driven by the server actions (`useTransition`, `router.refresh()` after success). Uses `Input`, `Label`, `Button`. Full component:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPlaceAction, updatePlaceAction, deletePlaceAction } from "@/lib/places/actions";

type Place = { id: string; label: string; destination: string; province: string; googleMapsUrl: string | null };

export function PlacesManager({ places }: { places: Place[] }) {
  const t = useTranslations("places");
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (action: (f: FormData) => Promise<{ ok: boolean; error?: string }>, f: FormData, onDone?: () => void) =>
    start(async () => {
      const res = await action(f);
      if (res.ok) { onDone?.(); router.refresh(); }
    });

  return (
    <div className="space-y-6">
      {places.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {places.map((p) =>
            editing === p.id ? (
              <li key={p.id} className="p-3">
                <PlaceFields prefix={p.id} initial={p} />
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" disabled={pending} onClick={() => {
                    const f = new FormData();
                    f.append("id", p.id);
                    for (const k of ["label", "destination", "province", "googleMapsUrl"]) {
                      const el = document.getElementById(`${p.id}-${k}`) as HTMLInputElement | null;
                      f.append(k, el?.value ?? "");
                    }
                    submit(updatePlaceAction, f, () => setEditing(null));
                  }}>{t("update")}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>{t("cancel")}</Button>
                </div>
              </li>
            ) : (
              <li key={p.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium">{p.label}</p>
                  <p className="truncate text-sm text-muted-foreground">{p.destination}, {p.province}</p>
                  {p.googleMapsUrl && (
                    <a href={p.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">{t("mapsLink")}</a>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(p.id)}>{t("edit")}</Button>
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => {
                    if (!window.confirm(t("deleteConfirm"))) return;
                    const f = new FormData();
                    f.append("id", p.id);
                    submit(deletePlaceAction, f);
                  }}>{t("delete")}</Button>
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
          const f = new FormData(e.currentTarget);
          submit(createPlaceAction, f, () => (e.target as HTMLFormElement).reset());
        }}
      >
        <p className="text-sm font-semibold">{t("addTitle")}</p>
        <PlaceFields prefix="new" />
        <Button type="submit" size="sm" disabled={pending}>{pending ? t("saving") : t("save")}</Button>
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
        <Input id={`${prefix}-googleMapsUrl`} name="googleMapsUrl" type="url" defaultValue={initial?.googleMapsUrl ?? ""} placeholder="https://maps.app.goo.gl/…" />
      </div>
    </div>
  );
}
```

(If `Button` lacks `size`/`variant` props, adapt to the real API — confirm by reading `components/ui/button.tsx` in Step 0 of this task.)

- [ ] **Step 3: Nav link.** In `app/(requester)/layout.tsx`, add after the `history` nav entry: `{ href: "/requester/places", label: t("places") },`.

- [ ] **Step 4: Typecheck.**

Run: `npm run typecheck`

- [ ] **Step 5: Commit** — `feat(places): requester saved-places management page + nav link`

---

### Task 8: Surface Maps link + in-Chula chip on detail/queue

**Files:**
- Modify: `app/(requester)/requester/[id]/page.tsx` (detail)
- Modify: `app/(admin)/admin/page.tsx` (queue rows)
- Create: `components/in-chula-chip.tsx` (shared presentational chip)

**Interfaces:**
- Consumes: `common.inChula` / `common.outsideChula`; `bookingDetail.mapsLink`. `outsideChula` + `googleMapsUrl` are scalar fields — already selected by default in both queries (no `include` change).

- [ ] **Step 1: Shared chip** — `components/in-chula-chip.tsx`:

```tsx
import { getTranslations } from "next-intl/server";

export async function InChulaChip({ outsideChula }: { outsideChula: boolean }) {
  const t = await getTranslations("common");
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
      outsideChula ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                   : "bg-muted text-muted-foreground"}`}>
      {outsideChula ? t("outsideChula") : t("inChula")}
    </span>
  );
}
```

- [ ] **Step 2: Requester detail** — in the Trip card `CardContent`, after the destination `Field`, add the Maps link + chip:

```tsx
          <Field label={t("destination")} value={`${booking.destination}, ${booking.province}`} />
          {booking.googleMapsUrl && (
            <Field label={t("mapsLink")} value={
              <a href={booking.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{t("mapsLink")}</a>
            } />
          )}
```

(Confirm `Field` accepts a `ReactNode` value — read `components/detail-field.tsx`; if it's string-only, render the link in a plain row instead.) Add `<InChulaChip outsideChula={booking.outsideChula} />` near the job number header.

- [ ] **Step 3: Admin queue rows** — in `app/(admin)/admin/page.tsx`, where each pending/approved booking row renders its destination, add `<InChulaChip outsideChula={b.outsideChula} />`. (Read the row JSX first to place it; `outsideChula` is already on the row object.)

- [ ] **Step 4: Typecheck + lint.**

Run: `npm run typecheck`

- [ ] **Step 5: Commit** — `feat(ui): surface stored Maps link + in-Chula chip on detail & queue`

---

### Task 9: Scheduler board — in-Chula chip + Maps pin (presentation only)

**Files:**
- Modify: `components/admin/scheduler-board-blocks.tsx`
- Modify: the board data loader feeding `SchedulerBooking` (find via `grep "SchedulerBooking"` — likely `scheduler-board-shared.ts` or the schedule page)

**Pre-req:** Read `docs/scheduling-algorithm.md` first (AGENTS.md hotspot rule). This task is **presentation only** — it must not change matcher/solver/no-overlap behaviour.

- [ ] **Step 1: Locate the type + loader.** `grep -rn "type SchedulerBooking\|SchedulerBooking =" components/admin lib`. Add `outsideChula: boolean` and `googleMapsUrl: string | null` to the `SchedulerBooking` type and to the `select`/mapping in the loader (additive — both scalar).

- [ ] **Step 2: Render in the trip block.** In `TimelineBlock`/`QueueCard` (the block showing destination), add a small `outsideChula` chip and, when `googleMapsUrl`, a map-pin icon link:

```tsx
{b.outsideChula && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-900">นอกจุฬาฯ</span>}
{b.googleMapsUrl && (
  <a href={b.googleMapsUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Google Maps">
    <MapPin className="h-3 w-3" aria-hidden />
  </a>
)}
```

(Import `MapPin` from `lucide-react`. Use `stopPropagation` so the link doesn't trigger the block's tap-to-open drawer.)

- [ ] **Step 3: Typecheck.**

Run: `npm run typecheck`

- [ ] **Step 4: Scheduling rule-check still green** (data-shape change near the board):

Run: `npx vitest run lib/booking --no-file-parallelism`
And: `npx tsx scripts/simulate-cr07.ts --scenario=mixed` (rule-check counters must stay 0).

- [ ] **Step 5: Commit** — `feat(board): in-Chula chip + Maps pin on scheduler blocks`

---

### Task 10: Full verification

- [ ] **Step 1: Typecheck.** `npm run typecheck` → PASS.
- [ ] **Step 2: Full test suite.** `npx vitest run --no-file-parallelism` → all green (unit always; integration if DB seeded).
- [ ] **Step 3: Scheduler scenarios.** `npx tsx scripts/simulate-cr07.ts --scenario=mixed` → rule-check counters 0.
- [ ] **Step 4: Dev smoke (optional).** `npm run dev`, open `/requester/new` (Maps field required, autofill works), `/requester/places` (CRUD), a booking detail (chip + link).
- [ ] **Step 5: Final commit if anything outstanding.**

---

## Self-Review

**Spec coverage:** §4 in-Chula (label + chips Tasks 6/8/9) ✓; §5 Maps link (schema T1, zod T2, persist T3, form T6, surface T8/T9) ✓; §6 saved places (schema T1, actions T4, page T7, autofill+inline-save T6) ✓; §7 edge cases (one-way copy via copy-at-submit + no FK T1; blank-maps place autofills others T6) ✓; §8 tests (T2 unit, T4 ownership, T3 integration) ✓; §10 affected files all mapped ✓.

**Open interpretation (flag to user):** §4 says "keep the checkbox storing `outsideChula` … pure i18n/label work; the stored bit and its meaning are unchanged" yet also "(checked 'in Chula' ⇒ outsideChula=false)". These conflict (the latter is an inversion). This plan takes the **no-inversion** reading: keep `outsideChula` semantics (checked = outside Chula), only refine label/helper copy. Lowest-risk; the spec itself warns inversion causes bugs. Revisit copy if the user prefers an inverted "within Chula" tick.

**Placeholder scan:** none — all steps carry concrete code/commands.

**Type consistency:** `BookingFormPlace`/`Place` shape `{id,label,destination,province,googleMapsUrl}` is consistent across T6/T7; actions return `ActionResult`; `listMyPlaces` returns `SavedPlace[]`.
</content>
</invoke>
