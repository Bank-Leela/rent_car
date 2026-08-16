import { type ReactNode } from "react";

// Titled section with an optional leading icon. Children render directly under
// the heading (callers space their own content).
export function Section({
  title,
  icon,
  id,
  children,
}: {
  title: string;
  icon?: ReactNode;
  /** Anchor target, so something elsewhere can link straight to this section. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}
