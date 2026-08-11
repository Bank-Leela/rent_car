import { describe, expect, it } from "vitest";
import { parseQueueSort, DEFAULT_QUEUE_SORT } from "@/lib/admin/queue-sort";

// The pending queue is worked first-come, first-served, so an admin arriving at
// /admin with no ?sort must see the earliest-submitted request at the top —
// not the one whose travel date happens to be soonest.
describe("queue sort default", () => {
  it("defaults to first-to-request", () => {
    expect(DEFAULT_QUEUE_SORT).toBe("oldest");
    expect(parseQueueSort(undefined)).toBe("oldest");
    expect(parseQueueSort("")).toBe("oldest");
    expect(parseQueueSort("nonsense")).toBe("oldest");
  });

  it("still honours an explicit choice", () => {
    expect(parseQueueSort("start")).toBe("start");
    expect(parseQueueSort("risk")).toBe("risk");
    expect(parseQueueSort("oldest")).toBe("oldest");
  });
});
