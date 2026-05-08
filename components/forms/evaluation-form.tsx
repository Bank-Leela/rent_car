"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitEvaluationAction } from "@/lib/booking/extra-actions";

const RATINGS = [
  { value: "VERY_GOOD", label: "Very good" },
  { value: "GOOD", label: "Good" },
  { value: "SLIGHTLY_NOT_GOOD", label: "Slightly not good" },
  { value: "NOT_GOOD", label: "Not good" },
] as const;

export function EvaluationForm({ tripId }: { tripId: string }) {
  const [rating, setRating] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requiresComment = rating === "NOT_GOOD" || rating === "SLIGHTLY_NOT_GOOD";

  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("tripId", tripId);
        startTransition(async () => {
          const res = await submitEvaluationAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="grid gap-2">
        <Label>How was the trip?</Label>
        <div className="grid sm:grid-cols-2 gap-2">
          {RATINGS.map((r) => (
            <label
              key={r.value}
              className={`flex items-center gap-2 rounded-md border p-3 cursor-pointer ${
                rating === r.value ? "bg-primary/10 border-primary" : "hover:bg-muted"
              }`}
            >
              <input
                type="radio"
                name="rating"
                value={r.value}
                onChange={(e) => setRating(e.target.value)}
                required
              />
              {r.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="comment">
          Comment {requiresComment && <span className="text-destructive">*</span>}
        </Label>
        <Textarea id="comment" name="comment" rows={3} required={requiresComment} />
        {requiresComment && (
          <p className="text-xs text-muted-foreground">A comment is required for negative ratings.</p>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending || !rating}>
        {pending ? "Submitting…" : "Submit evaluation"}
      </Button>
    </form>
  );
}
