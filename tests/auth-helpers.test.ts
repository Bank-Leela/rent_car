import { afterEach, describe, expect, it, vi } from "vitest";

// requireUser is the single choke point every RSC/server action funnels through.
// A user deactivated mid-session keeps a live JWT (isActive refreshed from the DB
// each request), so requireUser must bounce them to "/" — the site root is the
// sign-in screen. Mock the redirect + session so we can assert the gate without a
// real Next request.
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));

const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: () => getSession() }));

import { requireUser, requireRole, requireAnyRole } from "@/lib/auth-helpers";

const session = (over: Record<string, unknown> = {}) => ({
  user: { id: "u1", roles: ["ADMIN"], isActive: true, mustChangePassword: false, ...over },
});

afterEach(() => {
  redirect.mockClear();
  getSession.mockReset();
});

describe("requireUser — isActive enforcement", () => {
  it("redirects a deactivated user to the sign-in root", async () => {
    getSession.mockResolvedValue(session({ isActive: false }));
    await expect(requireUser()).rejects.toThrow("REDIRECT:/");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("passes an active user through", async () => {
    getSession.mockResolvedValue(session({ isActive: true }));
    await expect(requireUser()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated request to the sign-in root", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("REDIRECT:/");
  });

  it("requireRole inherits the isActive gate (deactivated ADMIN is bounced)", async () => {
    getSession.mockResolvedValue(session({ isActive: false, roles: ["ADMIN"] }));
    await expect(requireRole("ADMIN")).rejects.toThrow("REDIRECT:/");
  });

  it("requireAnyRole inherits the isActive gate", async () => {
    getSession.mockResolvedValue(session({ isActive: false, roles: ["ADMIN"] }));
    await expect(requireAnyRole(["ADMIN"])).rejects.toThrow("REDIRECT:/");
  });
});
