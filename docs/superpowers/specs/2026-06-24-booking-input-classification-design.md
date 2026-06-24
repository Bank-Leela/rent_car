# Design — Sub-project A: Booking input & classification

**Date:** 2026-06-24
**Source:** `meeting_changes_2026-06-23.md` §1 (booking form & requester input)
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** One of nine sub-projects decomposed from the 2026-06-23 P'Top walkthrough.
Covers three booking-input features only. Other sub-projects (lead-time gate,
approval tiers, notifications, mileage, outsourcing, dashboard, UI asks) are
tracked separately and out of scope here.

---

## 1. Goals

Three requester-facing booking-input refinements from §1 of the change-list:

1. **In-Chula hint** — a "travelling within Chula" signal the requester sets,
   shown to the admin as a hint. **No auto-classification** (admin decides
   รถเวร manually).
2. **Google-Maps link** — store a Maps link on every booking so the admin can
   eyeball the route/distance (used later for the >400 km two-driver call). The
   link is attached, never auto-pulled for distance (auto-pull costs money).
3. **Saved places** — a full, **per-requester-private**, managed list of
   destinations the requester reuses; autofills the booking form.

### Resolved open questions (from the change-list)

- **In-Chula → รถเวร classification:** decided **hint only**. The classifier is
  unchanged; WERN continues to come solely from `OnCallShift`. This sidesteps
  putting out-of-hours load on the single duty driver.
- **In-Chula 3 km radius:** **moot / dropped** — no auto-classification means no
  radius rule is needed.
- **Saved destinations (cache vs full):** decided **full saved-places feature**.
- **Saved-place ownership:** decided **private per requester**.

---

## 2. Existing state (what is already there)

- `Booking.outsideChula: Boolean @default(false)` already exists (migration
  `20260609150000_add_outside_chula`). It is the campus/off-campus bit,
  documented "informational for ops." Set via a form checkbox
  (`outsideChulaLabel`/`outsideChulaHelper`), persisted in `actions.ts`, and
  currently surfaced **only** on the admin batch page.
- The booking form already opens a Google-Maps **search** of the typed
  destination name (`openDestinationInMaps`, booking-form.tsx). There is **no
  stored Maps URL** on the booking.
- `Booking` has `destination`, `province`, `estimatedDistance Int?`.
- Classifier (`lib/booking/classification.ts`) emits TJW/OT/NORMAL only; WERN
  comes from `OnCallShift`. **This stays unchanged.**

---

## 3. Data model (Prisma — migration required)

- **No new in-Chula column.** Reuse `Booking.outsideChula`. The meeting's "in
  Chula" tick is exactly its inverse; keeping one column avoids inversion bugs.
- **New:** `Booking.googleMapsUrl String?` — the stored Maps link.
- **New model `SavedPlace`:**

  ```
  model SavedPlace {
    id            String   @id @default(cuid())
    userId        String
    user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    label         String                       // requester-given name, e.g. "MOU partner uni"
    destination   String
    province      String
    googleMapsUrl String?
    createdAt     DateTime @default(now())
    updatedAt     DateTime @updatedAt
    @@index([userId])
  }
  ```

  `User` gets the back-relation `savedPlaces SavedPlace[]`.

No foreign key from `Booking` to `SavedPlace`: a booking copies the place's
values at submit time, so deleting a place never affects past bookings.

---

## 4. Feature 1 — In-Chula hint (no schema change)

- Keep the form checkbox storing `outsideChula`. Align the label/helper to the
  meeting's framing ("travelling within Chula") while still persisting
  `outsideChula` (checked "in Chula" ⇒ `outsideChula = false`). Pure i18n/label
  work; the stored bit and its meaning are unchanged.
- **New admin surfacing** (today only on the batch page): add a compact
  "ในจุฬา / นอกจุฬา" chip to:
  - the scheduler board block (`components/admin/scheduler-board-blocks.tsx`),
  - the booking detail view,
  - the admin queue row (`app/(admin)/admin/page.tsx`).
  Presentation only — reads `outsideChula`. No logic/classifier change.

---

## 5. Feature 2 — Google-Maps link

- **Form:** a URL input beside destination. The existing "open in maps" button
  opens the *stored link* when present, falling back to today's name-search.
- **Validation:** zod `.url()`. **Required** for new bookings (meeting:
  "required on every booking"). Accept any host so shortened links
  (`maps.app.goo.gl`, `goo.gl/maps`) work; do **not** restrict to google.com.
  No distance is computed from the link.
- **Persistence:** `googleMapsUrl` written in `createBookingAction` (and the
  recurrence-expansion path, which copies booking fields to children).
- **Admin:** clickable link on booking detail; a small map-pin icon-link on the
  scheduler block.
- **Note:** the "required" rule is for the normal requester flow. The admin
  instant-booking path (sub-project B) may relax this; tracked there, not here.

---

## 6. Feature 3 — Saved places (private per requester)

- **Server actions** (`lib/places/actions.ts` or similar), all scoped to the
  authenticated user, ownership enforced server-side:
  - `listMyPlaces()` → caller's places, ordered by `label`.
  - `createPlace({ label, destination, province, googleMapsUrl? })`.
  - `updatePlace({ id, ... })` — 404/forbidden if not owner.
  - `deletePlace({ id })` — 404/forbidden if not owner.
- **Management page** `/requester/places`: list + add/edit/delete, built from
  existing form primitives (`Input`, `Label`, `Button`, `SelectField`). Linked
  from the requester nav.
- **Booking-form autofill:** a searchable combobox (`searchable-select`) lists
  the caller's places; selecting one autofills `destination`, `province`,
  `googleMapsUrl`. All fields remain editable after fill (autofill is a copy).
- **Inline save:** a "★ Save this destination" control on the booking form
  creates a `SavedPlace` from the current destination/province/maps-link,
  prompting for a `label`.

---

## 7. Validation & edge cases

- Maps URL: valid URL, any host. Empty rejected for new normal bookings.
- Autofill is a one-way copy: editing a booking never mutates the saved place,
  and editing/deleting a place never mutates past bookings.
- A place with a missing/blank `googleMapsUrl` autofills the other fields and
  leaves the booking's Maps-link empty (requester must then supply it, since the
  booking field is required).
- Recurrence: child bookings copy `googleMapsUrl` and `outsideChula` from the
  parent, consistent with current field-copy behaviour.

---

## 8. Testing

- **Unit:** zod schema accepts a valid Maps URL and rejects empty/non-URL for a
  normal booking; `outsideChula` round-trips.
- **Unit:** SavedPlace action ownership — user A cannot read, update, or delete
  user B's place.
- **Integration** (seeded dev DB, pattern of `schedule-actions.test.ts`): create
  a place → autofill → submit booking → the booking carries the copied
  `destination`/`province`/`googleMapsUrl`; deleting the place afterward leaves
  the booking intact.
- **No matcher/classification tests change** — classification is untouched
  (the point of "hint only"). Existing `npm test` must stay green.

---

## 9. Out of scope (deferred)

- 3 km-radius auto-classification (dropped — hint only).
- Department-shared saved places (chose private per requester).
- Admin instant-booking interaction with the "required" Maps link → sub-project B.
- Any change to the matcher / WERN / priority order (already correct in code:
  TJW → OT → WERN → NORMAL).

---

## 10. Affected files (anticipated)

- `prisma/schema.prisma` (+ migration): `Booking.googleMapsUrl`, `SavedPlace`,
  `User.savedPlaces`.
- `lib/booking/schema.ts`: add `googleMapsUrl` to `newBookingSchema`.
- `lib/booking/actions.ts`: persist `googleMapsUrl` (create + recurrence paths).
- `lib/places/*` (new): SavedPlace actions + zod schema.
- `components/forms/booking-form.tsx`: Maps-link input, autofill combobox,
  inline "★ Save", in-Chula label alignment.
- `app/(requester)/requester/places/page.tsx` (new) + nav link.
- `components/admin/scheduler-board-blocks.tsx`, `app/(admin)/admin/page.tsx`,
  booking-detail view: in-Chula chip + Maps-link surfacing.
- Tests under `lib/` + `tests/`.
- `messages/{en,th}.json`: labels for in-Chula framing, Maps link, saved places.
