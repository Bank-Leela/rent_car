import { describe, expect, it } from "vitest";
import { filterRows } from "./list-search";

const rows = [
  { name: "สมชาย", reg: "1กก-1111" },
  { name: "Sunee", reg: "2ขข-2222" },
  { name: "ประเสริฐ", reg: "1กก-3333" },
];

describe("filterRows", () => {
  it("returns all rows for an empty/whitespace query", () => {
    expect(filterRows(rows, "", ["name"])).toHaveLength(3);
    expect(filterRows(rows, "   ", ["name"])).toHaveLength(3);
  });
  it("matches case-insensitively on a single key", () => {
    expect(filterRows(rows, "sun", ["name"])).toEqual([rows[1]]);
  });
  it("matches across multiple keys", () => {
    expect(filterRows(rows, "1กก", ["name", "reg"])).toHaveLength(2);
  });
  it("returns none when nothing matches", () => {
    expect(filterRows(rows, "zzz", ["name", "reg"])).toEqual([]);
  });
});
