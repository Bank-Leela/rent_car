/**
 * Reset a user's password — and nothing else.
 *
 * The recovery path for "I deployed, then lost the password the seed printed".
 * `prisma db seed` would also work, but it re-pairs every car to its seeded
 * driver (it nulls `assignedDriverId` across the fleet and rebuilds it), so on a
 * live install it silently undoes pairing work done through /admin/fleet. This
 * touches exactly two columns on the accounts you name: `passwordHash` and
 * `mustChangePassword`. Bookings, leave, trips, roster and fleet are untouched.
 *
 * The new password is printed ONCE and stored only as a bcrypt hash — nobody,
 * including whoever runs this, can read it back afterwards.
 *
 * Usage (on the server: `set -a; source /etc/rent_car.env; set +a` first)
 *
 *   npx tsx scripts/reset-password.ts                    # admin only, generated password
 *   npx tsx scripts/reset-password.ts --user=driver3     # one account, by username or email
 *   npx tsx scripts/reset-password.ts --all              # every account
 *   npx tsx scripts/reset-password.ts --all --dry-run    # show who would change, write nothing
 *   NEW_PASSWORD='…' npx tsx scripts/reset-password.ts   # choose the password yourself
 */
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const all = args.includes("--all");
const userArg = args.find((a) => a.startsWith("--user="))?.slice("--user=".length);

// A supplied password is used as-is; otherwise generate one. 18 random bytes →
// 24 url-safe characters, same shape the seed prints.
const chosen = process.env.NEW_PASSWORD;
if (chosen && chosen.length < 8) {
  console.error("NEW_PASSWORD must be at least 8 characters.");
  process.exit(1);
}
const password = chosen || randomBytes(18).toString("base64url");

async function main() {
  if (all && userArg) {
    console.error("Use either --all or --user=<who>, not both.");
    process.exit(1);
  }

  // Default to the admin alone. Resetting every account by accident would lock
  // out real staff who still know their own password.
  const where = all
    ? {}
    : userArg
      ? { OR: [{ username: userArg }, { email: userArg }] }
      : { email: "admin@chula.ac.th" };

  const targets = await prisma.user.findMany({
    where,
    select: { id: true, username: true, email: true, isActive: true, roles: { select: { role: true } } },
    orderBy: { email: "asc" },
  });

  if (targets.length === 0) {
    console.error(
      userArg
        ? `No account matches "${userArg}" (tried username and email).`
        : "No admin@chula.ac.th account found — pass --user=<username|email>.",
    );
    process.exit(1);
  }

  console.log(`\n${dryRun ? "WOULD reset" : "Resetting"} the password for ${targets.length} account(s):`);
  for (const u of targets) {
    const roles = u.roles.map((r) => r.role).join("+") || "no role";
    console.log(`  ${(u.username ?? "-").padEnd(16)} ${(u.email ?? "").padEnd(30)} ${roles}${u.isActive ? "" : "  (INACTIVE)"}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing was written.\n");
    return;
  }

  const passwordHash = await hash(password, 12);
  const { count } = await prisma.user.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    // Deliberately only these two fields. Everything else about the account —
    // roles, department, signature, active flag — is left exactly as it was.
    data: { passwordHash, mustChangePassword: true },
  });

  const line = "─".repeat(60);
  console.log(
    [
      "",
      `  ┌${line}┐`,
      `  │${` NEW PASSWORD for the ${count} account(s) above`.padEnd(60)}│`,
      `  └${line}┘`,
      "",
      `      ${password}`,
      "",
      "  Shown once, here only — it is stored as a hash and cannot be read back.",
      "  Every account above must set a new password on its next sign-in.",
      "",
    ].join("\n"),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
