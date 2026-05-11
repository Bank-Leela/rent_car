// One-off: point seed-user-requester at a real inbox for email-delivery testing.
// Revert by re-running `npm run db:seed`.
import { PrismaClient } from "@prisma/client";

const TARGET_EMAIL = process.argv[2];
const TARGET_USER_ID = "seed-user-requester";

if (!TARGET_EMAIL || !TARGET_EMAIL.includes("@")) {
  console.error("Usage: npx tsx scripts/set-test-email.ts <email>");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const collision = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (collision && collision.id !== TARGET_USER_ID) {
    console.error(
      `Email ${TARGET_EMAIL} already belongs to user ${collision.id}; aborting.`,
    );
    process.exit(2);
  }
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: TARGET_USER_ID },
    select: { email: true },
  });
  await prisma.user.update({
    where: { id: TARGET_USER_ID },
    data: { email: TARGET_EMAIL },
  });
  console.log(`${TARGET_USER_ID}: ${before.email} -> ${TARGET_EMAIL}`);
}

main().finally(() => prisma.$disconnect());
