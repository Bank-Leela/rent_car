// Baht amounts, formatted once.
//
// Eight call sites printed money as `฿${value.toString()}`, which renders a
// hired-vehicle cost as ฿123213 — a number nobody can read at a glance and the
// one field on those screens that is actually about money. Distances in the same
// files already went through `toLocaleString()`, so the codebase knew to group
// digits; only currency had been missed.
//
// Prisma Decimal, number and string all arrive here (Decimal columns come back
// as Decimal, form values as strings), so the input is deliberately wide.
export function formatBaht(value: { toString(): string } | number | null | undefined): string {
  if (value == null) return "—";
  const n = typeof value === "number" ? value : Number(value.toString());
  if (!Number.isFinite(n)) return "—";
  // Whole baht stay whole; satang show only when present, so ฿4,500 does not
  // become the noisier ฿4,500.00 on a board full of round numbers.
  const fractionDigits = Number.isInteger(n) ? 0 : 2;
  return `฿${n.toLocaleString("th-TH", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
}
