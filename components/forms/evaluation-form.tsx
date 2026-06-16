"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitEvaluationAction } from "@/lib/booking/extra-actions";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";

const RATING_VALUES = ["VERY_GOOD", "GOOD", "SLIGHTLY_NOT_GOOD", "NOT_GOOD"] as const;

export function EvaluationForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("evaluationForm");
  const router = useRouter();
  const [rating, setRating] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);
  const { error, pending, run } = useFormAction(submitEvaluationAction, {
    bookingId,
    onSuccess: () => {
      setSubmitted(true);
      router.refresh();
    },
  });
  const requiresComment = rating === "NOT_GOOD" || rating === "SLIGHTLY_NOT_GOOD";

  if (submitted) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
        <CheckCircle2 className="h-5 w-5" aria-hidden />
        <div>
          <p className="font-medium">{t("thanksTitle")}</p>
          <p className="text-emerald-800/80 dark:text-emerald-300/80">{t("thanksDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <form action={run} className="space-y-4">
      <div className="grid gap-2">
        <Label>{t("howWasTheTrip")}</Label>
        <div className="grid sm:grid-cols-2 gap-2">
          {RATING_VALUES.map((value) => (
            <label
              key={value}
              className={`flex items-center gap-2 rounded-md border p-3 cursor-pointer ${
                rating === value ? "bg-primary/10 border-primary" : "hover:bg-muted"
              }`}
            >
              <input
                type="radio"
                name="rating"
                value={value}
                onChange={(e) => setRating(e.target.value)}
                required
              />
              {t(`ratings.${value}`)}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="comment">
          {t("comment")} {requiresComment && <span className="text-destructive">*</span>}
        </Label>
        <Textarea id="comment" name="comment" rows={3} required={requiresComment} />
        {requiresComment && (
          <p className="text-xs text-muted-foreground">{t("commentRequired")}</p>
        )}
      </div>

      <FormError message={error} />
      <Button type="submit" disabled={pending || !rating}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
