/**
 * One settings section. Title, the line that explains it, then the control —
 * the same three parts in the same order everywhere in the account area, so the
 * page reads as one list rather than a stack of unrelated panels.
 */
export function AccountSection({
  id,
  title,
  description,
  highlight,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  /** The password section while a temporary password is in force. */
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      // scroll-mt clears the sticky app bar, or the rail's own links land the
      // heading underneath it.
      className={`scroll-mt-24 px-5 py-6 sm:px-6 ${highlight ? "bg-primary/[0.04]" : ""}`}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {/* Controls are capped, not full-bleed. A 3–40 character username field
          running the whole width of the card reads as "type a lot here" and
          leaves the eye no line to follow back to the label; every settings
          screen worth copying keeps the control near the width of its content.
          The card stays wide so the descriptions have room to be sentences. */}
      <div className="mt-4 max-w-md">{children}</div>
    </section>
  );
}
