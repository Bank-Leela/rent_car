import { describe, it, expect } from "vitest";
import { resolveActiveSection, flatAdminRoutes, ADMIN_SECTIONS } from "./nav-sections";

describe("resolveActiveSection", () => {
  it("maps the queue root to Requests / Pending", () => {
    expect(resolveActiveSection("/admin")).toEqual({
      sectionKey: "requests",
      activeTabHref: "/admin",
    });
  });

  it("maps the decisions history to Requests", () => {
    expect(resolveActiveSection("/admin/decisions")).toEqual({
      sectionKey: "requests",
      activeTabHref: "/admin/decisions",
    });
  });

  it("keeps schedule, batch and simulate under Scheduling, with no tab strip", () => {
    // Batch and the simulator lost their nav tabs; the routes still resolve to
    // the section (so the primary nav stays lit when you reach them by URL),
    // and Scheduling renders standalone — activeTabHref is null throughout.
    expect(resolveActiveSection("/admin/schedule")).toEqual({
      sectionKey: "scheduling",
      activeTabHref: null,
    });
    expect(resolveActiveSection("/admin/batch")).toEqual({
      sectionKey: "scheduling",
      activeTabHref: null,
    });
    expect(resolveActiveSection("/admin/simulate")).toEqual({
      sectionKey: "scheduling",
      activeTabHref: null,
    });
  });

  it("drops batch and simulate from the flat (mobile) route list", () => {
    const hrefs = flatAdminRoutes().map((r) => r.href);
    expect(hrefs).toContain("/admin/schedule");
    expect(hrefs).not.toContain("/admin/batch");
    expect(hrefs).not.toContain("/admin/simulate");
  });

  it("does NOT let the '/admin' prefix swallow sibling sections", () => {
    // regression: '/admin' is a prefix of every admin route
    expect(resolveActiveSection("/admin/batch").sectionKey).toBe("scheduling");
    expect(resolveActiveSection("/admin/users").sectionKey).toBe("people");
  });

  it("treats Calendar as standalone (no active tab)", () => {
    expect(resolveActiveSection("/admin/calendar")).toEqual({
      sectionKey: "calendar",
      activeTabHref: null,
    });
  });

  it("highlights the parent section + tab for nested routes", () => {
    expect(resolveActiveSection("/admin/calendar/day/2026-06-30")).toEqual({
      sectionKey: "calendar",
      activeTabHref: null,
    });
    expect(resolveActiveSection("/admin/drivers/abc123")).toEqual({
      sectionKey: "people",
      activeTabHref: "/admin/drivers",
    });
    expect(resolveActiveSection("/admin/evaluations/drv1")).toEqual({
      sectionKey: "insights",
      activeTabHref: "/admin/evaluations",
    });
  });

  it("groups users, drivers and fleet under People", () => {
    expect(resolveActiveSection("/admin/fleet").sectionKey).toBe("people");
    expect(resolveActiveSection("/admin/drivers").activeTabHref).toBe("/admin/drivers");
  });

  it("falls back to Requests for a booking-detail id route", () => {
    expect(resolveActiveSection("/admin/clx9f8booking")).toEqual({
      sectionKey: "requests",
      activeTabHref: "/admin",
    });
  });

  it("returns null for a path outside the admin area", () => {
    expect(resolveActiveSection("/requester/new")).toEqual({
      sectionKey: null,
      activeTabHref: null,
    });
  });

  it("ships exactly five sections in order", () => {
    expect(ADMIN_SECTIONS.map((s) => s.key)).toEqual([
      "requests",
      "scheduling",
      "calendar",
      "people",
      "insights",
    ]);
  });
});
