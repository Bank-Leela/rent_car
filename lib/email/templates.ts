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

function appBaseUrl(): string {
  return process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "";
}

function viewUrl(path: string): string {
  const base = appBaseUrl();
  if (!base) return "";
  return `${base.replace(/\/$/, "")}${path}`;
}

function ctaButtonHtml(url: string, labelTh: string, labelEn: string): string {
  if (!url) return "";
  return `<p style="margin:24px 0">
  <a href="${url}" style="display:inline-block;background:#4c4ce0;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:system-ui,sans-serif;font-size:14px;font-weight:500">
    ${labelTh} / ${labelEn}
  </a>
</p>`;
}

function ctaButtonText(url: string, labelTh: string, labelEn: string): string {
  if (!url) return "";
  return `\n${labelTh} / ${labelEn}: ${url}`;
}

function bookingFactsText(b: BookingDetailed): string {
  return [
    `เลขที่งาน / Job number: ${b.jobNumber}`,
    `ผู้ขอใช้รถ / Requester: ${b.requester.name ?? b.requester.email} (${b.department.nameEn})`,
    `วัตถุประสงค์ / Purpose: ${b.purpose}`,
    `ปลายทาง / Destination: ${b.destination} (${b.province})`,
    `เริ่ม / Start: ${fmt(b.startAt)}`,
    `สิ้นสุด (กลับถึงคณะ) / End (back at faculty): ${fmt(b.endAt)}`,
    `ผู้โดยสาร / Passengers: ${b.passengerCount}`,
    b.estimatedDistance != null
      ? `ระยะทางประมาณ / Est. distance: ${b.estimatedDistance} km`
      : null,
    b.vehicle ? `รถ / Vehicle: ${b.vehicle.registrationNumber}` : null,
    b.primaryDriver
      ? `พนักงานขับรถ / Driver: ${b.primaryDriver.user.name ?? b.primaryDriver.user.email}`
      : null,
    b.secondaryDriver
      ? `พนักงานขับรถผู้ช่วย / Co-driver: ${b.secondaryDriver.user.name ?? b.secondaryDriver.user.email}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function bookingFactsHtml(b: BookingDetailed): string {
  const rows: Array<[string, string]> = [
    ["เลขที่งาน / Job number", b.jobNumber],
    [
      "ผู้ขอใช้รถ / Requester",
      `${b.requester.name ?? b.requester.email} (${b.department.nameEn})`,
    ],
    ["วัตถุประสงค์ / Purpose", b.purpose],
    ["ปลายทาง / Destination", `${b.destination} (${b.province})`],
    ["เริ่ม / Start", fmt(b.startAt)],
    ["สิ้นสุด (กลับถึงคณะ) / End", fmt(b.endAt)],
    ["ผู้โดยสาร / Passengers", String(b.passengerCount)],
  ];
  if (b.estimatedDistance != null) {
    rows.push(["ระยะทางประมาณ / Est. distance", `${b.estimatedDistance} km`]);
  }
  if (b.vehicle) rows.push(["รถ / Vehicle", b.vehicle.registrationNumber]);
  if (b.primaryDriver) {
    rows.push([
      "พนักงานขับรถ / Driver",
      b.primaryDriver.user.name ?? b.primaryDriver.user.email!,
    ]);
  }
  if (b.secondaryDriver) {
    rows.push([
      "พนักงานขับรถผู้ช่วย / Co-driver",
      b.secondaryDriver.user.name ?? b.secondaryDriver.user.email!,
    ]);
  }

  return `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:4px 0">${v}</td></tr>`,
  )
  .join("\n")}
</table>`;
}

function wrapHtml(intro: string, body: string, cta: string): string {
  return `<div style="max-width:560px;margin:0 auto;font-family:system-ui,sans-serif;color:#1f2937">
  <p style="font-size:15px;line-height:1.5">${intro}</p>
  ${body}
  ${cta}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
  <p style="font-size:12px;color:#6b7280">ระบบจองรถคณะ / Faculty Vehicle Booking · อย่าตอบกลับอีเมลฉบับนี้ / Do not reply</p>
</div>`;
}

// ---- Templates ----

export function adminNewBookingEmail(b: BookingDetailed) {
  const subject = `[ใหม่ / New ${b.jobNumber}] ${b.requester.name ?? b.requester.email}`;
  const introTh = `มีการจองใหม่รออนุมัติ`;
  const introEn = `A new booking is awaiting review.`;
  const url = viewUrl(`/admin/${b.id}`);
  return {
    subject,
    text: `${introTh}\n${introEn}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ตรวจสอบการจอง", "Review booking")}`,
    html: wrapHtml(
      `${introTh}<br/>${introEn}`,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ตรวจสอบการจอง", "Review booking"),
    ),
  };
}

export function requesterAssignedEmail(b: BookingDetailed) {
  const subject = `จัดรถแล้ว / Assigned · ${b.jobNumber}`;
  const introTh = `การจองของคุณได้รับการจัดรถและพนักงานขับรถแล้ว`;
  const introEn = `Your booking has been assigned a vehicle and driver.`;
  const url = viewUrl(`/requester/${b.id}`);
  return {
    subject,
    text: `${introTh}\n${introEn}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ดูรายละเอียดการจอง", "View booking")}`,
    html: wrapHtml(
      `${introTh}<br/>${introEn}`,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ดูรายละเอียดการจอง", "View booking"),
    ),
  };
}

export function requesterDeniedEmail(b: BookingDetailed, reason: string) {
  const subject = `ไม่อนุมัติ / Denied · ${b.jobNumber}`;
  const introTh = `คำขอใช้รถของคุณไม่ได้รับอนุมัติ เหตุผล: ${reason}`;
  const introEn = `Your booking was denied. Reason: ${reason}`;
  const url = viewUrl(`/requester/${b.id}`);
  return {
    subject,
    text: `${introTh}\n${introEn}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ดูรายละเอียดการจอง", "View booking")}`,
    html: wrapHtml(
      `${introTh}<br/>${introEn}`,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ดูรายละเอียดการจอง", "View booking"),
    ),
  };
}

export function requesterApprovedEmail(b: BookingDetailed) {
  const subject = `อนุมัติแล้ว / Approved · ${b.jobNumber}`;
  const introTh = `การจองของคุณได้รับการอนุมัติจากหัวหน้าภาควิชาแล้ว · ผู้ดูแลระบบจะจัดรถให้ในขั้นตอนถัดไป`;
  const introEn = `Your booking was approved by your department head. The administrator will assign a vehicle shortly.`;
  const url = viewUrl(`/requester/${b.id}`);
  return {
    subject,
    text: `${introTh}\n${introEn}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ดูรายละเอียดการจอง", "View booking")}`,
    html: wrapHtml(
      `${introTh}<br/>${introEn}`,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ดูรายละเอียดการจอง", "View booking"),
    ),
  };
}
