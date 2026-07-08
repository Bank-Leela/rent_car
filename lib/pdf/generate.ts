/**
 * Mark the official request form available for a booking. The form itself is
 * rendered live at download time (`lib/pdf/official-form.ts`) so the approval,
 * driver, and trip sections reflect current state — so this only returns the
 * marker written to `Booking.pdfUrl`, whose presence gates the download link
 * (which appears once a booking is decided).
 */
export async function generateBookingPdf(bookingId: string): Promise<string> {
  void bookingId;
  return "official";
}
