export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    // Every page's title lives here, so this is the one place the scale can be
    // set without editing ~40 files. It was text-2xl (24px) on a 1440px canvas —
    // the same size as a card title further down the page, so nothing anchored
    // the eye at the top. 28px, rising to 32px from `sm`, with tighter tracking:
    // display sizes read loose at their default spacing.
    <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
      <div>
        <h1 className="text-[1.75rem] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[2rem]">
          {title}
        </h1>
        {description && (
          // 15px, not 14px: this is the one line that says what the page is for,
          // and at text-sm it was the same size as every metadata line below it.
          <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
