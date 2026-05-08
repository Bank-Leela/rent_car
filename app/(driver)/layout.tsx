import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const isDriver = session.user.roles.includes("DRIVER");
  const isCoord = session.user.roles.includes("GARAGE_COORDINATOR");
  if (!isDriver && !isCoord) redirect("/");

  return (
    <AppShell
      title="Vehicle Booking"
      roleBadge={isCoord && !isDriver ? "Garage Coordinator" : "Driver"}
      user={session.user}
      nav={[{ href: "/driver", label: isCoord ? "All assignments" : "Today" }]}
    >
      {children}
    </AppShell>
  );
}
