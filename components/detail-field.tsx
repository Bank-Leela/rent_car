// Label-over-value cell used in the booking detail pages' two-column cards.
export function DetailField({
  label,
  value,
  colSpan,
  labelClassName = "text-xs",
}: {
  label: string;
  value: string;
  colSpan?: boolean;
  labelClassName?: string;
}) {
  return (
    <div className={colSpan ? "sm:col-span-2" : ""}>
      <div className={`${labelClassName} uppercase tracking-wide text-muted-foreground`}>
        {label}
      </div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
