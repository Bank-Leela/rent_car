// Shared Prisma `include` shape for a booking's requester/department/vehicle/
// driver relations. Plain data (not a server action) — kept in its own module
// so "use server" files that need it stay compliant with Next's rule that
// every export from such a file must be an async function.
export const bookingDetailInclude = {
  requester: true,
  department: true,
  vehicle: true,
  primaryDriver: { include: { user: true } },
  secondaryDriver: { include: { user: true } },
} as const;
