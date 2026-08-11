import { describe, expect, it } from "vitest";
import { groupBySeries } from "@/lib/booking/series";

const at = (d: string) => new Date(`${d}T08:00:00`);
const row = (id: string, parent: string | null, day: string) => ({
  id, recurrenceParentId: parent, startAt: at(day),
});

describe("groupBySeries", () => {
  it("puts the parent and its children in one group", () => {
    const g = groupBySeries([
      row("p", null, "2027-01-06"),
      row("c1", "p", "2027-01-13"),
      row("c2", "p", "2027-01-20"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.key).toBe("p");
    expect(g[0]!.items.map((i) => i.id)).toEqual(["p", "c1", "c2"]);
  });

  it("a non-recurring booking is a group of one", () => {
    const g = groupBySeries([row("solo", null, "2027-02-01")]);
    expect(g).toHaveLength(1);
    expect(g[0]!.items).toHaveLength(1);
  });

  it("orders occurrences by date even when the input is not", () => {
    const g = groupBySeries([
      row("c2", "p", "2027-01-20"),
      row("p", null, "2027-01-06"),
      row("c1", "p", "2027-01-13"),
    ]);
    expect(g[0]!.items.map((i) => i.id)).toEqual(["p", "c1", "c2"]);
  });

  it("keeps groups in order of first appearance, so the caller's sort survives", () => {
    const g = groupBySeries([
      row("b", null, "2027-03-02"),
      row("a", null, "2027-03-01"),
      row("bc", "b", "2027-03-09"),
    ]);
    expect(g.map((x) => x.key)).toEqual(["b", "a"]);
  });

  // The bug this exists to prevent: a page limit counts CARDS. Slicing rows
  // first let one five-week series fill a five-card page on its own.
  it("five series survive a five-card slice even when they hold many occurrences", () => {
    const rows = [];
    for (let s = 0; s < 8; s++) {
      rows.push(row(`p${s}`, null, `2027-04-0${(s % 9) + 1}`));
      for (let c = 0; c < 6; c++) rows.push(row(`p${s}c${c}`, `p${s}`, `2027-05-0${(c % 9) + 1}`));
    }
    const groups = groupBySeries(rows).slice(0, 5);
    expect(groups).toHaveLength(5);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(35);
  });
});
