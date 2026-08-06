"use client";

import { useRouter } from "next/navigation";
import { DateTimePicker } from "@/components/ui/date-time-picker";

// The board's date control. Prev/next arrows only get you to an adjacent day —
// reaching a date three weeks out meant twenty clicks. This opens the app's own
// Thai calendar (Buddhist-era, Thai month names); the native datetime-local
// popover renders its months and Clear/Today in English.
//
// Navigation, not a form field: picking a day pushes ?date= on the current
// route, so the server component re-renders that day.
export function BoardDatePicker({ basePath, date }: { basePath: string; date: string }) {
  const router = useRouter();
  return (
    <div className="w-44">
      <DateTimePicker
        id="board-date"
        name=""
        dateOnly
        defaultValue={`${date}T00:00`}
        onChange={(v) => {
          const day = (v || "").slice(0, 10);
          if (day) router.push(`${basePath}?date=${day}`);
        }}
      />
    </div>
  );
}
