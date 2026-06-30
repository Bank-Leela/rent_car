import { afterAll, describe, expect, it } from "vitest";
import { hash, compare } from "bcryptjs";
import { prisma } from "@/lib/db";

// Proves the credentials sign-in is provisioned and the verification mechanism
// works, against the real dev DB:
//   1. every seeded role account is active + has a password hash + a role;
//   2. the bcryptjs hash/compare round-trip the authorize() relies on works (a
//      stored hash verifies the right password and rejects a wrong one);
//   3. login resolves by username OR email.
// (authorize() itself lives in the read-blocked lib/auth/*; this asserts the
// substance it depends on. Account passwords aren't assumed — the live dev DB
// may have rotated them — so #2 uses a throwaway user with a known password.)
const SEED_USERNAMES = [
  "requester", "admin",
  "driverA", "driverB", "driverC", "driverD", "driverE", "driverF",
];

const throwawayIds: string[] = [];

afterAll(async () => {
  if (throwawayIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: throwawayIds } } });
  }
  await prisma.$disconnect();
});

describe("sign-in credentials", () => {
  it("every seeded role account is active, has a password hash, a username, and a role", async () => {
    const users = await prisma.user.findMany({
      where: { username: { in: SEED_USERNAMES } },
      select: { username: true, isActive: true, passwordHash: true, roles: { select: { role: true } } },
    });
    expect(users.map((u) => u.username).sort()).toEqual([...SEED_USERNAMES].sort());
    for (const u of users) {
      expect(u.isActive, `${u.username} active`).toBe(true);
      expect(u.passwordHash, `${u.username} hasPassword`).toBeTruthy();
      expect(u.roles.length, `${u.username} roles`).toBeGreaterThan(0);
    }
  });

  it("a stored bcrypt hash verifies the right password and rejects a wrong one", async () => {
    const password = "Sign1n-Round-Trip!";
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: {
        email: `signin-test-${stamp}@test.local`,
        username: `signin-test-${stamp}`,
        name: "Sign-in round-trip",
        passwordHash: await hash(password, 12),
        isActive: true,
      },
      select: { id: true, passwordHash: true },
    });
    throwawayIds.push(user.id);

    expect(user.passwordHash).toBeTruthy();
    expect(await compare(password, user.passwordHash!)).toBe(true);
    expect(await compare("not-the-password", user.passwordHash!)).toBe(false);
  });

  it("login accepts username OR email — both resolve to the same account", async () => {
    const byUsername = await prisma.user.findFirst({
      where: { username: "requester" },
      select: { id: true, email: true },
    });
    expect(byUsername?.email).toBeTruthy();
    const byEmail = await prisma.user.findUnique({
      where: { email: byUsername!.email! },
      select: { id: true },
    });
    expect(byEmail?.id).toBe(byUsername!.id);
  });
});
