import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditActionLabel } from "@/lib/booking/audit-labels";

/**
 * Every audit action written anywhere in the app must have a Thai label.
 *
 * These labels are a plain map rather than next-intl keys precisely because
 * next-intl resolves at runtime — but that only moves the failure, it does not
 * remove it: an action with no entry still shows a Thai admin a bare English
 * identifier in the history. Nothing checked the two sides matched, so adding an
 * action was enough to break it silently. This walks the source for the literals.
 */
describe("audit labels", () => {
  it("covers every action string used in the codebase", () => {
    // Hand-rolled walk: node:fs globSync needs Node 22 and this project pins 20.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
        return /\.tsx?$/.test(e.name) ? [p] : [];
      });
    const files = ["lib", "app", "components"].flatMap((d) => walk(d));
    const used = new Set<string>();
    for (const f of files) {
      if (f.includes("audit-labels")) continue;
      for (const m of readFileSync(f, "utf8").matchAll(/action:\s*"([A-Z_]+)"/g)) {
        used.add(m[1]!);
      }
    }
    expect(used.size).toBeGreaterThan(10);
    const unlabelled = [...used].filter((a) => auditActionLabel(a) === a).sort();
    expect(unlabelled).toEqual([]);
  });
});
