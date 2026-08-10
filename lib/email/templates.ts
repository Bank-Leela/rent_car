import { format } from "date-fns";
import { th } from "date-fns/locale";
import type { Booking, Department, User, Vehicle, Driver } from "@prisma/client";

type BookingDetailed = Booking & {
  requester: User;
  department: Department;
  vehicle: Vehicle | null;
  primaryDriver: (Driver & { user: User }) | null;
  secondaryDriver: (Driver & { user: User }) | null;
};

const fmt = (d: Date) => format(d, "EEE d MMM yyyy HH:mm", { locale: th });

// What names the trip in a subject line: its ชื่อการจอง, falling back to the
// destination for the schemas that allow an empty one. `purpose` is free text
// with no upper bound, so it is collapsed and clipped — a subject only has to
// be distinguishable from its neighbours in an inbox list.
function tripName(b: BookingDetailed): string {
  const name = (b.purpose.trim() || b.destination).replace(/\s+/g, " ").trim();
  return name.length > 60 ? `${name.slice(0, 59)}…` : name;
}

function appBaseUrl(): string {
  return process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "";
}

function viewUrl(path: string): string {
  const base = appBaseUrl();
  if (!base) return "";
  return `${base.replace(/\/$/, "")}${path}`;
}

function ctaButtonHtml(url: string, label: string): string {
  if (!url) return "";
  return `<p style="margin:24px 0">
  <a href="${url}" style="display:inline-block;background:#4c4ce0;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:system-ui,sans-serif;font-size:14px;font-weight:500">
    ${label}
  </a>
</p>`;
}

function ctaButtonText(url: string, label: string): string {
  if (!url) return "";
  return `\n${label}: ${url}`;
}

function bookingFactsText(b: BookingDetailed): string {
  return [
    `ผู้ขอใช้รถ: ${b.requester.name ?? b.requester.email} (${b.department.nameTh})`,
    `ชื่อการจอง: ${b.purpose}`,
    `ปลายทาง: ${b.destination} (${b.province})`,
    `เริ่ม: ${fmt(b.startAt)}`,
    `สิ้นสุด (กลับถึงคณะ): ${fmt(b.endAt)}`,
    `ผู้โดยสาร: ${b.passengerCount}`,
    b.estimatedDistance != null
      ? `ระยะทางประมาณ: ${b.estimatedDistance} km`
      : null,
    b.vehicle ? `รถ: ${b.vehicle.registrationNumber}` : null,
    b.primaryDriver
      ? `พนักงานขับรถ: ${b.primaryDriver.user.name ?? b.primaryDriver.user.email}`
      : null,
    b.secondaryDriver
      ? `พนักงานขับรถผู้ช่วย: ${b.secondaryDriver.user.name ?? b.secondaryDriver.user.email}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function bookingFactsHtml(b: BookingDetailed): string {
  const rows: Array<[string, string]> = [
    [
      "ผู้ขอใช้รถ",
      `${b.requester.name ?? b.requester.email} (${b.department.nameTh})`,
    ],
    ["ชื่อการจอง", b.purpose],
    ["ปลายทาง", `${b.destination} (${b.province})`],
    ["เริ่ม", fmt(b.startAt)],
    ["สิ้นสุด (กลับถึงคณะ)", fmt(b.endAt)],
    ["ผู้โดยสาร", String(b.passengerCount)],
  ];
  if (b.estimatedDistance != null) {
    rows.push(["ระยะทางประมาณ", `${b.estimatedDistance} km`]);
  }
  if (b.vehicle) rows.push(["รถ", b.vehicle.registrationNumber]);
  if (b.primaryDriver) {
    rows.push([
      "พนักงานขับรถ",
      b.primaryDriver.user.name ?? b.primaryDriver.user.email!,
    ]);
  }
  if (b.secondaryDriver) {
    rows.push([
      "พนักงานขับรถผู้ช่วย",
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
  <p style="font-size:12px;color:#6b7280">ระบบจองรถ คณะแพทยศาสตร์ · กรุณาอย่าตอบกลับอีเมลฉบับนี้</p>
</div>`;
}

// ---- Templates ----

export function adminNewBookingEmail(b: BookingDetailed) {
  const subject = `[ใหม่ ${tripName(b)}] ${b.requester.name ?? b.requester.email}`;
  const introTh = `มีการจองใหม่รออนุมัติ`;
  const url = viewUrl(`/admin/${b.id}`);
  return {
    subject,
    text: `${introTh}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ตรวจสอบการจอง")}`,
    html: wrapHtml(
      introTh,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ตรวจสอบการจอง"),
    ),
  };
}

export function requesterAssignedEmail(b: BookingDetailed) {
  const subject = `จัดรถแล้ว · ${tripName(b)}`;
  const introTh = `การจองของคุณได้รับการจัดรถและพนักงานขับรถแล้ว`;
  const url = viewUrl(`/requester/${b.id}`);
  return {
    subject,
    text: `${introTh}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ดูรายละเอียดการจอง")}`,
    html: wrapHtml(
      introTh,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ดูรายละเอียดการจอง"),
    ),
  };
}

export function requesterDeniedEmail(b: BookingDetailed, reason: string) {
  const subject = `ไม่อนุมัติ · ${tripName(b)}`;
  const introTh = `คำขอใช้รถของคุณไม่ได้รับอนุมัติ เหตุผล: ${reason}`;
  const url = viewUrl(`/requester/${b.id}`);
  return {
    subject,
    text: `${introTh}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ดูรายละเอียดการจอง")}`,
    html: wrapHtml(
      introTh,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ดูรายละเอียดการจอง"),
    ),
  };
}

// Sent when the trip completes. The evaluate CTA doubles as the evaluation
// reminder (an unevaluated COMPLETED booking blocks the requester's next
// booking) — there is no job scheduler, so this immediate email is the nudge.
export function requesterCompletedEmail(b: BookingDetailed) {
  const subject = `เสร็จสิ้น · ${tripName(b)}`;
  const introTh = `การเดินทางของคุณเสร็จสิ้นแล้ว กรุณาประเมินการเดินทาง (จำเป็นก่อนจองครั้งถัดไป)`;
  const url = viewUrl(`/requester/${b.id}`);
  return {
    subject,
    text: `${introTh}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ประเมินการเดินทาง")}`,
    html: wrapHtml(
      introTh,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ประเมินการเดินทาง"),
    ),
  };
}

// Sent to the requester when someone ELSE (an admin) cancels their booking —
// a requester cancelling their own booking gets no self-email.
export function requesterCancelledEmail(b: BookingDetailed, reason: string) {
  const subject = `ยกเลิกแล้ว · ${tripName(b)}`;
  const introTh = `การจองของคุณถูกยกเลิกโดยเจ้าหน้าที่ เหตุผล: ${reason}`;
  const url = viewUrl(`/requester/${b.id}`);
  return {
    subject,
    text: `${introTh}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ดูรายละเอียดการจอง")}`,
    html: wrapHtml(
      introTh,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ดูรายละเอียดการจอง"),
    ),
  };
}

// Sent to the requester when their booking is handed to an outside vendor
// (bus/charter or over-capacity overflow) instead of a fleet car.
export function requesterOutsourcedEmail(b: BookingDetailed, vendor: string) {
  const subject = `จ้างรถภายนอก · ${tripName(b)}`;
  const introTh = `การจองของคุณถูกจัดเป็นการจ้างรถภายนอก โดย: ${vendor}`;
  const url = viewUrl(`/requester/${b.id}`);
  return {
    subject,
    text: `${introTh}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ดูรายละเอียดการจอง")}`,
    html: wrapHtml(
      introTh,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ดูรายละเอียดการจอง"),
    ),
  };
}

// Sent to admins when a requester cancels a booking that had already been
// acted on (approved / assigned) — the slot is freed and P'Top may want to
// re-fill it or clear the board.
export function adminBookingCancelledEmail(b: BookingDetailed, reason: string) {
  const subject = `[ยกเลิก ${tripName(b)}] คืนสล็อตว่าง`;
  const introTh = `ผู้ขอยกเลิกการจองที่จัดรถ/อนุมัติแล้ว สล็อตถูกคืนคิว เหตุผล: ${reason}`;
  const url = viewUrl(`/admin/${b.id}`);
  return {
    subject,
    text: `${introTh}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ดูการจอง")}`,
    html: wrapHtml(
      introTh,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ดูการจอง"),
    ),
  };
}

// Sent to a requester whose dispatched trip lost its driver because that driver
// was marked off (sick/leave). The trip is back in the APPROVED queue for
// P'Top to re-dispatch (e.g. onto the duty car).
export function requesterDriverOffEmail(b: BookingDetailed) {
  const subject = `ต้องจัดรถใหม่ needed · ${tripName(b)}`;
  const introTh = `พนักงานขับรถที่ได้รับมอบหมายลางาน การจองของคุณกำลังถูกจัดรถใหม่ เวลาเดินทางเดิมไม่เปลี่ยน`;
  const url = viewUrl(`/requester/${b.id}`);
  return {
    subject,
    text: `${introTh}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ดูรายละเอียดการจอง")}`,
    html: wrapHtml(
      introTh,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ดูรายละเอียดการจอง"),
    ),
  };
}

// Admin heads-up when a requester changes the time of an already-dispatched
// (ASSIGNED) trip: the assignment was cleared and the trip is back in the
// APPROVED queue for re-dispatch at the new time.
export function adminTimeChangedEmail(b: BookingDetailed) {
  const subject = `[เปลี่ยนเวลา ${tripName(b)}] ต้องจัดรถใหม่`;
  const introTh = `ผู้ขอเปลี่ยนเวลาเดินทางของงานที่จัดรถแล้ว ระบบได้ปลดรถ/คนขับออก และย้ายงานกลับคิวรอจัดรถ`;
  const url = viewUrl(`/admin/${b.id}`);
  return {
    subject,
    text: `${introTh}\n\n${bookingFactsText(b)}${ctaButtonText(url, "จัดรถใหม่")}`,
    html: wrapHtml(
      introTh,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "จัดรถใหม่"),
    ),
  };
}

export function requesterApprovedEmail(b: BookingDetailed) {
  const subject = `อนุมัติแล้ว · ${tripName(b)}`;
  const introTh = `การจองของคุณได้รับการอนุมัติจากหัวหน้าภาควิชาแล้ว · ผู้ดูแลระบบจะจัดรถให้ในขั้นตอนถัดไป`;
  const url = viewUrl(`/requester/${b.id}`);
  return {
    subject,
    text: `${introTh}\n\n${bookingFactsText(b)}${ctaButtonText(url, "ดูรายละเอียดการจอง")}`,
    html: wrapHtml(
      introTh,
      bookingFactsHtml(b),
      ctaButtonHtml(url, "ดูรายละเอียดการจอง"),
    ),
  };
}
