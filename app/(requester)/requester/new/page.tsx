import { requireRole } from "@/lib/auth-helpers";
import { BookingForm } from "@/components/forms/booking-form";

export default async function NewBookingPage() {
  await requireRole("REQUESTER");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New booking</h1>
        <p className="text-muted-foreground">Submit a vehicle request for review.</p>
      </div>
      <BookingForm />
    </div>
  );
}
