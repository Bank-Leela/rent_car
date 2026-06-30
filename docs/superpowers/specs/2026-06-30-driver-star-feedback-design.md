# Per-Driver Star Feedback + Dashboard — Design

**Date:** 2026-06-30 · **Status:** Approved (verbal), implementing on `feat/driver-star-feedback`.

## Goal

Make trip feedback a Google-Maps-style review (**1–5 stars + optional comment**) and add an
admin **dashboard** of per-driver cards (avg ★ + count) that drill into each driver's reviews.

## Decisions

- Stars **1–5** (Int). Comment **always optional**.
- Dashboard restructures the existing `/admin/evaluations` (already in admin nav) into driver cards.
- 6 drivers → 6 cards (all shown, even with 0 reviews).
- Feedback maps to a driver via `Evaluation → Trip → Booking.primaryDriver`.
- Who submits stays the same (requester, after a completed trip).

## Data model

`Evaluation.rating`: `EvaluationRating` enum → **`Int`** (1–5). Drop the now-unused
`EvaluationRating` enum. `comment` stays `String?`. One migration
`20260630140000_evaluation_star_rating` — clean (0 evaluations after the data wipe):

```sql
ALTER TABLE "Evaluation" DROP COLUMN "rating";
ALTER TABLE "Evaluation" ADD COLUMN "rating" INTEGER NOT NULL;
DROP TYPE "EvaluationRating";
```

## Components / files

- `components/ui/star-rating.tsx` (new) — reusable stars: read-only display (`value`,
  fractional fill for averages) + an interactive input mode (`onChange`, hover, keyboard).
- `components/forms/evaluation-form.tsx` — replace the 4 radio levels with the 1–5 star
  input; comment always optional (drop `requiresComment`).
- `lib/booking/extra-actions.ts` — `submitEvaluationAction`: `rating` → int 1–5
  (`z.coerce.number().int().min(1).max(5)`); drop the negative-rating comment refine.
- `app/(admin)/admin/evaluations/page.tsx` — driver-card dashboard: for each Driver,
  aggregate evaluations where `trip.booking.primaryDriverId = driver.id` → avg + count;
  render cards (name, avg ★, count) linking to `[driverId]`. Drivers with 0 reviews show
  "no reviews yet."
- `app/(admin)/admin/evaluations/[driverId]/page.tsx` (new) — that driver's reviews
  (★ + comment + date/job), newest first; back link.
- `components/admin/driver-reviews-list.tsx` (new) — the reviews list (replaces the old
  `evaluations-list-client` flat list, which is removed).
- i18n `adminEvaluations` (avg, reviews, reviewCount, noReviews, backToDashboard) +
  `evaluationForm` (star a11y labels); drop the old `NOT_GOOD…VERY_GOOD` rating labels.

## Error handling

- Invalid rating (not 1–5) → zod → existing `ActionResult` error.
- Driver not found on `[driverId]` → `notFound()`.

## Verification

- `prisma migrate` + `prisma generate`; `npm run typecheck && npm test`.
- Live: submit a star review on a completed trip → appears on the driver's card avg +
  in the drill-in; cards render for all 6 drivers.
- Adversarial review workflow before merge.
