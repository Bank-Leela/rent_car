import { format } from "date-fns";
import type { Booking, Department, User, Vehicle, Driver } from "@prisma/client";

type BookingDetailed = Booking & {
  requester: User;
  department: Department;
  vehicle: Vehicle | null;
  primaryDriver: (Driver & { user: User }) | null;
  secondaryDriver: (Driver & { user: User }) | null;
};

const fmt = (d: Date) => format(d, "EEE d MMM yyyy HH:mm");

function bookingFactsText(b: BookingDetailed): string {
  return [
    `Job number: ${b.jobNumber}`,
    `Requester:  ${b.requester.name ?? b.requester.email} (${b.department.nameEn})`,
    `Purpose:    ${b.purpose}`,
    `Destination: ${b.destination} (${b.province})`,
    `Start:      ${fmt(b.startAt)}`,
    `End (back at faculty): ${fmt(b.endAt)}`,
    `Passengers: ${b.passengerCount}`,
    b.estimatedDistance != null ? `Est. distance: ${b.estimatedDistance} km` : null,
    b.vehicle ? `Vehicle:   ${b.vehicle.registrationNumber}` : null,
    b.primaryDriver ? `Driver:    ${b.primaryDriver.user.name ?? b.primaryDriver.user.email}` : null,
    b.secondaryDriver
      ? `Co-driver: ${b.secondaryDriver.user.name ?? b.secondaryDriver.user.email}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function bookingFactsHtml(b: BookingDetailed): string {
  const rows: Array<[string, string]> = [
    ["Job number", b.jobNumber],
    ["Requester", `${b.requester.name ?? b.requester.email} (${b.department.nameEn})`],
    ["Purpose", b.purpose],
    ["Destination", `${b.destination} (${b.province})`],
    ["Start", fmt(b.startAt)],
    ["End (back at faculty)", fmt(b.endAt)],
    ["Passengers", String(b.passengerCount)],
  ];
  if (b.estimatedDistance != null) rows.push(["Est. distance", `${b.estimatedDistance} km`]);
  if (b.vehicle) rows.push(["Vehicle", b.vehicle.registrationNumber]);
  if (b.primaryDriver)
    rows.push(["Driver", b.primaryDriver.user.name ?? b.primaryDriver.user.email!]);
  if (b.secondaryDriver)
    rows.push(["Co-driver", b.secondaryDriver.user.name ?? b.secondaryDriver.user.email!]);

  return `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#555">${k}</td><td style="padding:4px 0">${v}</td></tr>`,
  )
  .join("\n")}
</table>`;
}

export function adminNewBookingEmail(b: BookingDetailed) {
  const subject = `[New booking ${b.jobNumber}] ${b.requester.name ?? b.requester.email}`;
  const intro = `A new booking is awaiting review.`;
  return {
    subject,
    text: `${intro}\n\n${bookingFactsText(b)}`,
    html: `<p>${intro}</p>${bookingFactsHtml(b)}`,
  };
}

export function requesterAssignedEmail(b: BookingDetailed) {
  const subject = `Booking ${b.jobNumber} assigned`;
  const intro = `Your booking has been assigned a vehicle and driver.`;
  return {
    subject,
    text: `${intro}\n\n${bookingFactsText(b)}`,
    html: `<p>${intro}</p>${bookingFactsHtml(b)}`,
  };
}

export function requesterDeniedEmail(b: BookingDetailed, reason: string) {
  const subject = `Booking ${b.jobNumber} denied`;
  const intro = `Your booking was denied. Reason: ${reason}`;
  return {
    subject,
    text: `${intro}\n\n${bookingFactsText(b)}`,
    html: `<p>${intro}</p>${bookingFactsHtml(b)}`,
  };
}

export function requesterApprovedEmail(b: BookingDetailed) {
  const subject = `Booking ${b.jobNumber} approved`;
  const intro = `Your booking was approved by your department head.`;
  return {
    subject,
    text: `${intro}\n\n${bookingFactsText(b)}`,
    html: `<p>${intro}</p>${bookingFactsHtml(b)}`,
  };
}
