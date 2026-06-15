// The bordered error banner repeated across the booking forms. Renders nothing
// when there's no message. `size` matches the per-form text scale (default sm).
export function FormError({
  message,
  size = "sm",
}: {
  message: string | null;
  size?: "xs" | "sm";
}) {
  if (!message) return null;
  return (
    <div
      className={`rounded-md border border-destructive/30 bg-destructive/10 p-3 ${
        size === "xs" ? "text-xs" : "text-sm"
      } text-destructive`}
    >
      {message}
    </div>
  );
}
