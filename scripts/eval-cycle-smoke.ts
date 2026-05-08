// Verify: blocked → submit eval → unblocked.
import { PrismaClient } from "@prisma/client";
import { isBlockedByPendingEvaluation } from "../lib/booking/rules";

const prisma = new PrismaClient();

async function pendingFor(userId: string) {
  return prisma.trip.count({
    where: {
      booking: { requesterId: userId, status: "COMPLETED" },
      evaluation: null,
    },
  });
}

async function main() {
  const userId = "seed-user-requester";

  const before = await pendingFor(userId);
  console.log("before: pendingEvals =", before, "blocked =", isBlockedByPendingEvaluation(before));

  if (before === 0) {
    console.log("(no completed-no-eval trip; nothing to test)");
    return;
  }

  const trip = await prisma.trip.findFirstOrThrow({
    where: {
      booking: { requesterId: userId, status: "COMPLETED" },
      evaluation: null,
    },
    select: { id: true, bookingId: true },
  });
  console.log("→ submitting evaluation for tripId =", trip.id);

  await prisma.evaluation.create({
    data: { tripId: trip.id, rating: "GOOD", comment: undefined },
  });

  const after = await pendingFor(userId);
  console.log("after:  pendingEvals =", after, "blocked =", isBlockedByPendingEvaluation(after));
}

main().finally(() => prisma.$disconnect());
