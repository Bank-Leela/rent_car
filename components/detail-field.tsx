// Labelled value cell used on the booking detail pages (requester / admin /
// driver). `size` controls the label scale — driver detail uses "sm", the rest
// default to "xs".
export function Field({
  label,
  value,
  colSpan,
  size = "xs",
}: {
  label: string;
  value: string;
  colSpan?: boolean;
  size?: "xs" | "sm";
}) {
  return (
    <div className={colSpan ? "sm:col-span-2" : ""}>
      <div className={`${size === "sm" ? "text-sm" : "text-xs"} uppercase tracking-wide text-muted-foreground`}>
        {label}
      </div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
