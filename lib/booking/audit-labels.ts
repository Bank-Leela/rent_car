/**
 * Thai labels for audit-log action codes.
 *
 * Both timeline surfaces — the requester's own ประวัติ card and the admin
 * detail page — rendered the raw code with `action.replace(/_/g, " ").toLowerCase()`,
 * so a Thai-only app printed "booking denied", "batch matched" and
 * "driver off handoff wern" to the person who filed the request. `AuditLog.action`
 * is a free-form string, so nothing typed it and nothing caught it.
 *
 * A plain map rather than next-intl keys, deliberately: next-intl resolves at
 * runtime and throws on a missing key, and this vocabulary grows every time
 * someone adds a `logTransition` call. Here an unknown code degrades to the old
 * humanised form instead of breaking the page — the same trade the rest of the
 * app makes for message keys it cannot enumerate.
 */
const AUDIT_ACTION_TH: Record<string, string> = {
  DEPARTMENT_CHANGED: "เปลี่ยนภาควิชา",
  // Booking lifecycle
  BOOKING_SUBMITTED: "ส่งคำขอ",
  BOOKING_SUBMITTED_ON_BEHALF: "ส่งคำขอแทนผู้ขอ (โดยผู้ดูแล)",
  BOOKING_SUBMITTED_BACKDATED: "บันทึกย้อนหลัง (โดยผู้ดูแล)",
  BOOKING_APPROVED: "อนุมัติ",
  BOOKING_APPROVED_FORCED_DAY_FULL: "อนุมัติทั้งที่รถเต็ม (ผู้ดูแลยืนยัน)",
  BOOKING_APPROVED_OUTSOURCED_DAY_FULL: "อนุมัติ — ใช้รถเช่าภายนอก (รถเต็ม)",
  DOCUMENT_APPROVED: "เอกสารเรียบร้อย",
  BOOKING_DENIED: "ไม่อนุมัติ",
  BOOKING_CANCELLED: "ยกเลิกการจอง",
  BOOKING_OUTSOURCED: "ส่งรถนอก",
  BOOKING_UNOUTSOURCED: "ยกเลิกการส่งรถนอก",
  ESCALATED_TO_KHUN_TOP: "ส่งต่อให้ผู้ดูแลตัดสิน",
  RECLAIM_DECISION: "ตัดสินใจเรื่องคนขับเวร",

  // Dispatch
  MATCHED: "จับคู่รถและคนขับ",
  BATCH_MATCHED: "จัดรอบอัตโนมัติ",
  TJW_REQUEST_ORDER_MATCHED: "จัด ตจว. ตามลำดับคำขอ",
  VEHICLE_ALLOCATED: "จัดรถ",
  ASSIGNED: "จัดรถและคนขับ",
  UNASSIGNED: "ถอนรถและคนขับ",
  TIME_CHANGED: "แก้เวลาเดินทาง",
  // Written before TIME_CHANGED became general; old rows still render.
  WERN_TIME_CHANGED: "แก้เวลางานเวร",

  // Trip
  TRIP_STARTED: "ออกเดินทาง",
  TRIP_COMPLETED: "จบงาน",

  // Driver availability
  DRIVER_LEAVE_SET: "บันทึกวันลา",
  DRIVER_LEAVE_CLEARED: "ยกเลิกวันลา",
  DRIVER_OFF_RELEASE: "คนขับลา — ปล่อยงานกลับคิว",
  DRIVER_OFF_HANDOFF_WERN: "คนขับลา — ส่งงานให้คนขับเวร",
  DRIVER_OFF_CODRIVER_REPLACED: "คนขับลา — เปลี่ยนคนขับเสริม",
  DRIVER_OFF_CODRIVER_LOST: "คนขับลา — ไม่มีคนขับเสริมแทน",
  DRIVER_OFF_NEEDS_REVIEW: "คนขับลา — ต้องตรวจสอบเอง",
  ON_CALL_SHIFT_SET: "กำหนดคนขับเวร",

  // LESS submission tracker
  LESS_SUBMITTED: "ส่ง LESS",
  LESS_UNSUBMITTED: "ยกเลิกการส่ง LESS",
};

/** The Thai label, or the old humanised code when the vocabulary has outgrown the map. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_TH[action] ?? action.replace(/_/g, " ").toLowerCase();
}
