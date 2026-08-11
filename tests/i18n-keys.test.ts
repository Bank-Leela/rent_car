import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// next-intl resolves message keys at RUNTIME, so a key that does not exist —
// or one read from the wrong namespace — compiles cleanly and then renders the
// literal key ("titleStation") to a Thai-only user. tsc structurally cannot see
// it, `npm run build` cannot see it, and it only surfaces when someone opens
// that exact page. This has shipped twice; this test is why it should not again.
//
// It resolves every LITERAL t("…") call against the namespace its translator was
// created with. Template-literal keys (t(`reason_${x}`)) are out of reach and
// stay the caller's responsibility.
const msgs = JSON.parse(readFileSync("messages/th.json", "utf8")) as Record<string, unknown>;

function resolves(namespace: string, key: string): boolean {
  let cur: unknown = msgs;
  for (const part of [...namespace.split("."), ...key.split(".")]) {
    if (!part) continue;
    if (typeof cur !== "object" || cur === null || !(part in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string";
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "docs"].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Strip comments so an example call in a doc comment is not read as a real one. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("i18n message keys", () => {
  it("every literal t(\"key\") resolves in its own namespace", () => {
    const missing: string[] = [];
    let checked = 0;

    for (const file of sourceFiles(".")) {
      const src = stripComments(readFileSync(file, "utf8"));
      const translators = new Map<string, string>();
      for (const m of src.matchAll(
        /const\s+(\w+)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\(\s*["'`]([\w.]+)["'`]\s*\)/g,
      )) {
        translators.set(m[1]!, m[2]!);
      }
      for (const [variable, namespace] of translators) {
        for (const m of src.matchAll(new RegExp(`\\b${variable}\\(\\s*["'\`]([\\w.]+)["'\`]`, "g"))) {
          checked++;
          if (!resolves(namespace, m[1]!)) missing.push(`${file}: ${variable}("${m[1]}") -> ${namespace}.${m[1]}`);
        }
      }
    }

    expect(checked).toBeGreaterThan(500); // the walker still finds the app
    expect(missing).toEqual([]);
  });
});
