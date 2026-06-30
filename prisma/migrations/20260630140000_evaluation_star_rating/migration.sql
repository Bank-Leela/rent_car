-- Trip feedback becomes a 1–5 star rating (was the 4-level EvaluationRating enum).
-- 0 evaluations exist after the data wipe, so drop + re-add the column and drop the enum.
ALTER TABLE "Evaluation" DROP COLUMN "rating";
ALTER TABLE "Evaluation" ADD COLUMN     "rating" INTEGER NOT NULL;
DROP TYPE "EvaluationRating";
