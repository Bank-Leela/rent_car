// The bordered error banner repeated across the booking forms. Renders nothing
// when there's no message. `size` matches the per-form text scale (default sm).
const SIZE_CLASS = { xs: "text-xs", sm: "text-sm", base: "text-base" } as const;

export function FormError({
  message,
  size = "sm",
}: {
  message: string | null;
  size?: "xs" | "sm" | "base";
}) {
  if (!message) return null;
  return (
    <div
      className={`rounded-md border border-destructive/30 bg-destructive/10 p-3 ${SIZE_CLASS[size]} text-destructive`}
    >
      {message}
    </div>
  );
}
