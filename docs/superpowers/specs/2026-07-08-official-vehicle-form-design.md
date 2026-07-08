# Official vehicle-request form (AcroForm fill) — design

**Date:** 2026-07-08 · **Status:** approved (brainstorm)

Generate the faculty's official **แบบฟอร์มขออนุมัติใช้ยานพาหนะ คณะแพทยศาสตร์ จุฬาฯ**
(rev. 2569) filled from a booking, replacing the current English react-pdf
download. The template is a real AcroForm (`public/2 แบบฟอร์ม…e.pdf`, 57 fields:
46 text + 11 checkbox) prepared with Adobe Acrobat Sign signer tags
(`_es_:signer:`). We fill the data fields and leave the signature fields live
for an Adobe Sign step.

## Decisions (locked)
1. **Signatures:** fill data fields; leave the 3 `Signature*_es_:signer:signature`
   fields empty + fillable for Adobe Sign. Do **not** flatten.
2. **Placement:** replace the existing `/api/files/booking-pdf/[id]` output with
   this form (one canonical document). Old `lib/pdf/booking-pdf.tsx` retired.
3. **New capture:** add `parkingCost` (Text25) + `fuelType` (Text21) to the
   driver end-trip form so the usage section fills completely.

## Architecture
- **`lib/pdf/official-form.ts`** — `fillVehicleForm(data): Promise<Uint8Array>`.
  - Loads the template via `fs.readFile(process.cwd()/public/…pdf)`.
  - `registerFontkit`, embeds `lib/pdf/fonts/NotoSansThai-Regular.ttf` (subset).
  - Fills text fields (`setText` + `setFontSize(9)` + `updateAppearances(thai)`)
    and checkboxes (`.check()`); wraps each set in try/catch so a renamed field
    never 500s the download.
  - Leaves `Signature7/8/9_es_:signer:signature` untouched.
  - Returns `doc.save()` bytes. Never flattens.
- **Deps:** `pdf-lib`, `@pdf-lib/fontkit` (added). Thai TTF committed under
  `lib/pdf/fonts/` (pdf-lib needs ttf/otf; the app's woff2 won't load).
- **Route:** `/api/files/booking-pdf/[id]` reads the booking (+ department, +
  vehicle, + primary/secondary driver, + trip), maps to the fill payload, streams
  `application/pdf`. Auth unchanged (requester owns it OR admin/station).

## Field map (all 57)
**Request** — fill_1 requester name · fill_2 `department.nameTh` · fill_3 phone ·
EMail email · fill_5 destination · fill_6 province · fill_7 purpose ·
Text17 passengerCount · Date11/Date10/Date12 travel day/month/year(BE) ·
Date13/Date14 start/end time (HH:mm) · Text18 pickupLocation · Text22 pickup time ·
toggle_1 คอย = `waitAtDestination`, toggle_2 ไม่คอย = `!waitAtDestination` ·
toggle_3 + Text19 return-pickup (`returnTrip` && `pickupReturnTime`) ·
fill_8/fill_9 coordinatorName/Phone · fill_10 passengerNotes ·
fill_11 dept-head printed name (delegate/approver) · Date26/Date16/Date15 form date d/m/y(BE).

**Approval** — toggle_4 ให้บริการได้ (status ∈ APPROVED/ASSIGNED/COMPLETED/OUTSOURCED) ·
toggle_5 ไม่ได้ (DENIED) · toggle_6 รถเต็ม (denial reason mentions full/เต็ม) ·
toggle_7 + `undefined` other-reason text · fill_17 approver name · fill_18 decidedAt date.

**Driver usage** — fill_12 `vehicle.registrationNumber` (plate) ·
fill_13 plate province (parse/blank) · toggle_8-11 vehicle type
(VAN→toggle_8, 6-wheel→9, PICKUP→10, SEDAN→11) · fill_14 startMileage + startedAt time ·
fill_15 endedAt time · Text21 `trip.fuelType` · Text20 `trip.fuelLiters` ·
Text23 `trip.fuelCost` · Text24 `trip.tollwayCost` · Text25 `trip.parkingCost` ·
`undefined_2` driver printed name · fill_20 trip date.

**Recipient (out-of-hours)** — Text5/Text6 trip from–to time · fill_21 requester/recipient name.

**Left for Adobe Sign** — Signature7 (dept head), Signature8 (driver),
Signature9 (recipient). Filled by the signer in Adobe Sign, never by us.

*Note:* the travel Date* fields carry `_es_:signer:date` tags. We fill them with
booking data as text; when uploading to Adobe Sign, assign only Signature7/8/9
(and optionally the signer-date next to each) to signers so the pre-filled
travel dates aren't overwritten.

## New capture (decision 3)
- Schema: `Trip.parkingCost Decimal?(10,2)`, `Trip.fuelType String?`. Migration
  (additive, nullable) via hand-authored SQL + `migrate deploy`.
- End-trip form (`trip-forms.tsx`): fuel-type text input + parking-cost number,
  both optional, beside the existing fuel/toll fields. Zod + action pass-through.
- Surface on driver detail + drawer + station payload alongside the others.

## Out of scope / flagged (not built here)
- **Lead-time mismatch:** the form's notes state 7 วัน (BKK) / 15 วัน (upcountry) /
  1 เดือน (curriculum); the app enforces 3 biz-days / 7 biz-days / 30 cal-days.
  Rule change — needs a separate decision; not touched.
- Adobe Sign **API** integration (auto-send). We produce the filled fillable PDF;
  uploading to Adobe Sign stays manual.
- Multi-day: the form is 1 day / 1 sheet by design; recurring children each
  generate their own sheet (already separate bookings).

## Verification
- Scratchpad render already proves the fill pipeline + Thai embedding work.
- `npm run typecheck && npm run lint && vitest` (+ a unit test for the payload
  mapper: booking → field values, incl. checkbox logic + BE-year dates).
- Manual: download for a seed booking, open in Acrobat, confirm Thai + fields +
  live signature fields.
