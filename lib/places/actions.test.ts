import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let CURRENT_USER = "seed-user-requester";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: CURRENT_USER, roles: ["REQUESTER"] } })),
}));

import { prisma } from "@/lib/db";
import { createPlaceAction, updatePlaceAction, deletePlaceAction, listMyPlaces } from "@/lib/places/actions";

const USER_A = "seed-user-requester";
const USER_B = "seed-user-approver";
const created: string[] = [];

function fd(input: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(input)) f.append(k, v);
  return f;
}

beforeAll(async () => {
  for (const id of [USER_A, USER_B]) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) throw new Error(`Seed user ${id} missing — run npx prisma db seed`);
  }
  await prisma.savedPlace.deleteMany({
    where: { userId: { in: [USER_A, USER_B] }, label: { startsWith: "TEST_" } },
  });
});

afterAll(async () => {
  await prisma.savedPlace.deleteMany({ where: { id: { in: created } } });
  await prisma.savedPlace.deleteMany({ where: { label: { startsWith: "TEST_" } } });
  await prisma.$disconnect();
});

describe("saved-place ownership", () => {
  it("creates a place for the caller and lists only theirs", async () => {
    CURRENT_USER = USER_A;
    const res = await createPlaceAction(fd({ label: "TEST_A", destination: "A Uni", province: "Bangkok" }));
    expect(res.ok).toBe(true);
    const mine = await listMyPlaces();
    const row = mine.find((p) => p.label === "TEST_A");
    expect(row).toBeTruthy();
    created.push(row!.id);

    CURRENT_USER = USER_B;
    const theirs = await listMyPlaces();
    expect(theirs.find((p) => p.label === "TEST_A")).toBeUndefined();
  });

  it("forbids user B from updating user A's place", async () => {
    CURRENT_USER = USER_A;
    await createPlaceAction(fd({ label: "TEST_A2", destination: "A2", province: "Bangkok" }));
    const row = (await listMyPlaces()).find((p) => p.label === "TEST_A2")!;
    created.push(row.id);

    CURRENT_USER = USER_B;
    const res = await updatePlaceAction(fd({ id: row.id, label: "HACK", destination: "X", province: "Y" }));
    expect(res.ok).toBe(false);
    const fresh = await prisma.savedPlace.findUnique({ where: { id: row.id } });
    expect(fresh!.label).toBe("TEST_A2");
  });

  it("forbids user B from deleting user A's place", async () => {
    CURRENT_USER = USER_A;
    await createPlaceAction(fd({ label: "TEST_A3", destination: "A3", province: "Bangkok" }));
    const row = (await listMyPlaces()).find((p) => p.label === "TEST_A3")!;
    created.push(row.id);

    CURRENT_USER = USER_B;
    const res = await deletePlaceAction(fd({ id: row.id }));
    expect(res.ok).toBe(false);
    expect(await prisma.savedPlace.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("clears the maps link when the owner edits it to empty", async () => {
    CURRENT_USER = USER_A;
    await createPlaceAction(
      fd({ label: "TEST_A4", destination: "A4", province: "Bangkok", googleMapsUrl: "https://maps.app.goo.gl/keep" }),
    );
    const row = (await listMyPlaces()).find((p) => p.label === "TEST_A4")!;
    created.push(row.id);
    expect(row.googleMapsUrl).toBe("https://maps.app.goo.gl/keep");

    const res = await updatePlaceAction(
      fd({ id: row.id, label: "TEST_A4", destination: "A4", province: "Bangkok", googleMapsUrl: "" }),
    );
    expect(res.ok).toBe(true);
    const fresh = await prisma.savedPlace.findUnique({ where: { id: row.id } });
    expect(fresh!.googleMapsUrl).toBeNull();
  });
});
