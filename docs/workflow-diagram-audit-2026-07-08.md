# Workflow diagram ("Workflow ระบบจองรถคณะ") — compliance audit

**Date:** 2026-07-08. Source: FigJam board (5 zoomed captures). Legend:
✓ implemented · ≈ partial/differs · ✗ missing. File refs point at the
implementation (or where it would go).

## Main request flow

| Diagram node | Status | In the app |
|---|---|---|
| ผู้ขอกรอกคำขอใช้รถ ระบุรถบัส/กรณีพิเศษได้ | ✓ | Booking form; `preferredVehicleType=BUS_OUTSOURCED`, SMUS charter area, urgent/emergency (`booking-form.tsx`) |
| จองเป็นช่วง/เกิดซ้ำ? → สร้างหลายรายการ ลงปฏิทิน | ✓ | Recurrence (`recurringWeekdays/Until`, `expandRecurringDates` → child bookings + `RecurrenceRule`) |
| ลีดไทม์พอ? กทม.3 / ตจว.7 วัน | ✓ | `LEAD_TIME_BANGKOK_DAYS=3` (business), upcountry 7, SMUS 30, urgent 1 (`lib/booking/rules.ts`) |
| ไม่พอ → เตือน แก้ไขคำขอ | ✓ | Form validation + `updateBookingTimeAction` (requester can edit until trip runs — extended 2026-07-08) |
| Admin จองได้โดยไม่ดูเวลา | ✓ | Admin "Book this slot" via simulate (`bookSimulatedSlotAction`) has no lead-time gate |
| ให้ User แนบ Google Map ให้ admin คลิกดู | ✓ | `googleMapsUrl` required on the form; link on admin detail |
| …ก่อน Approve เอาระยะทางจาก Googlemap อัตโนมัติ | ≈ | Distance is **manual** (`estimatedDistance`); deliberate — no Maps API spend. Distance still drives the co-driver rule |
| ฟีเจอร์บันทึกสถานที่เหมือน Grab | ✗ (by decision) | SavedPlace was built (`c7caa13`) then **removed on purpose** (`ff0c141`); templates cover the recurring-trip case |

## Approval

| Diagram node | Status | In the app |
|---|---|---|
| เส้นทางอนุมัติตามเขต/เวลา: ในเขต=1 คน · นอกเวลา=2 คน · ตจว./ค้างคืน=3 คน | ✗ (by decision) | App has **single ADMIN approval** for everything — the APPROVER role was removed at your request (2026-06-30, "admins handle approvals"). No 1/2/3-tier chain exists. **Diagram and your standing decision conflict — needs your call.** |
| ไม่ต้องมี Role Super Admin | ✓ | Roles are REQUESTER/ADMIN/DRIVER only |
| ลายเซ็น? e-sign/มอบหมาย | ✓ | Signature image + delegation (`User.signatureImageUrl`, `delegatedTo`) on the avatar-menu Signature page; signature rides the PDF |
| Export Paper → เซ็นใน LESS → Admin กดในระบบ | ≈ | Booking **PDF export exists** (`lib/pdf/booking-pdf.tsx`, download on detail pages) and admin approves in-system — but there is **no LESS integration**; the paper/LESS round-trip is manual outside the app |
| แนบลายเซ็นผู้มีอำนาจ เพื่อ Export เข้า LESS | ≈ | Signature upload ✓; "into LESS" ✗ (same as above) |
| บันทึกข้อความอนุญาตให้ธุรการจัดการ/เปิด account · Level ศูนย์/หน่วย | ✗ | No per-clerk authorization records and no org-level (ศูนย์/หน่วย) hierarchy — departments only |
| อนุมัติ? → ไม่อนุมัติ → ปฏิเสธ อีเมลแจ้งเหตุผล | ✓ | Approve/deny with reason + `requesterDeniedEmail`; deny presets |

## Capacity / outsourcing

| Diagram node | Status | In the app |
|---|---|---|
| แอดมิน: เข้าคิว ตรวจปฏิทิน | ✓ | Admin queue + calendar + `dayCapacity` |
| รถเต็ม/เกินเพดานต่อวัน? | ✓ | Day-cap → WAITLIST at submit; queue shows over-capacity section + OT recommendation (1-click assign, 2026-07-08) |
| เต็ม → จ้างภายนอก? (รถบัส/สัมมนา) | ✓ | `OUTSOURCED` status + `AdHocVehicle` rows on the board; BUS_OUTSOURCED auto-flags `needsOutsourcing` |
| จ้างภายนอก: ขอใบเสนอราคา บันทึกค่าใช้จ่าย | ✓ (`f_partial2`) | Vendor / cost / quote-reference recorded on the outsource form **and now shown on the requester detail** (was admin-only); a separate quote *document* upload is the only piece left, gated on the ✗ recipient-signature work |
| แจ้งผู้ขอ | ✓ (`b95baaa`) | `requesterOutsourcedEmail` — bilingual, sent on outsource |

## Dispatch & drivers

| Diagram node | Status | In the app |
|---|---|---|
| ระยะทางเกินเกณฑ์? → จัดคนขับ 2 คน ค้างคืน | ✓ | >400 km co-driver rule (`TWO_DRIVER_DISTANCE_KM`), TJW overnight model |
| ถ้าคนขับไม่ไปต่างจังหวัด | ✓ | Driver mark-off (`DriverUnavailability`) excludes from auto-assign; P'Top reassigns |
| จัดคิว แบ่งงานเช้า-บ่าย เพื่อ buffer | ✓ | NORMAL cap = one morning + one afternoon; universal 2h gap; solver |
| จัดรถและคนขับ แสดงชื่อ-เบอร์-ทะเบียน | ✓ (`b95baaa`) | Requester detail shows driver + co-driver **name + phone + plate** |
| เลือกรถอะไร / Admin เพิ่มรถในระบบได้ | ✓ (`b95baaa`) | Fleet page edits type/capacity, pairs drivers, **and adds vehicles** (`createVehicleAction`) |
| Noti User ด้วยอีเมล | ✓ | `requesterAssignedEmail` |
| ลาป่วย → ย้ายเป็นรถเวรแทน + อีเมลแจ้ง user | ✓ (`b95baaa`) | Marking a driver off **releases their upcoming ASSIGNED trips that day** back to APPROVED + emails requesters (`requesterDriverOffEmail`); P'Top re-dispatches (e.g. duty car). Release, not auto-assign, keeps "P'Top decides" |
| คนขับ: ดูงานวันนี้ บันทึกไมล์เริ่ม | ✓ | Kiosk today panel (2026-07-08) + `StartTripForm` mileage |
| ยกเลิก → คืนสล็อตว่าง แจ้งแอดมิน | ✓ (`b95baaa`) | Slot/rotation released ✓; **requester self-cancel of an approved/assigned booking now emails admins** (`adminBookingCancelledEmail`) |
| เวลาเปลี่ยน/เลิกช้า? → แก้เวลา เซ็นกำกับ flag OT | ✓ (`f_partial2`) | Requester time-change ✓; **late finish now flagged as overtime** (actual end − scheduled end, shown on driver detail + kiosk drawer). Recipient *countersign* is still the ✗ recipient-signature item, tracked separately |
| เดินทาง บันทึกไมล์จบและน้ำมัน (บาท/ลิตร/ทางด่วน) | ✓ (`b95baaa`) | End-trip records mileage + fuel **฿ and liters** + toll ฿ + expressway |
| เปิด 3 account, คนรถใช้ account เดียว สิทธิ์น้อยลง | ✓ | Exactly the current model: requester/admin/**shared driver-station** login |
| ผู้รับบริการเซ็นยืนยัน (จบงาน) | ✗ | No recipient signature at trip end — post-trip star evaluation instead |
| ระบบปริ้น form ได้ | ✓ | Booking-request PDF |

## Closing loop

| Diagram node | Status | In the app |
|---|---|---|
| ข้อมูลเข้าแดชบอร์ด | ✓ | Admin dashboard (funnel, utilisation, roster alerts) |
| ประเมินหลังเดินทาง ปลดล็อกจองถัดไป | ✓ | 1–5 star eval; `isBlockedByPendingEvaluation` gates the next booking; completed-email CTA (2026-07-08) |
| รายงานประจำเดือน กราฟและ CSV | ✓ | Monthly buckets, charts, CSV exports |
| Option: ขอรถในจุฬา | ✓ | WITHIN_CHULA trip area → รถเวร routing |
| Option: ขอรถเสริมกรณีรถหมด | ≈ | Waitlist + OT fit + outsourcing cover it; no literal "extra car request" |

## Score

**Original:** ~40 elements → 24 ✓ · 11 ≈ · 5 ✗.
**Partial-fix pass 1 (`b95baaa`):** 6 closed → 30 ✓ · 5 ≈ · 5 ✗.
**Partial-fix pass 2 (2026-07-08):** outsource details on requester detail +
late-finish overtime flag → **32 ✓ · 3 ≈ · 5 ✗**.

### Remaining ≈ — blocked on an external system / cost decision (not buildable in-app)
- **Auto distance from Google Maps** — needs a paid Maps Distance API key + billing opt-in. Conflicts with the no-API-cost decision. *Give me a key + say "accept the cost" and it's ~1 file.*
- **LESS export/sign round-trip** — needs the LESS system's API/credentials. The PDF + authority signature already exist; only the LESS handshake is missing. *Needs LESS access from IT.*
- **Outsource quote *document* upload** — cost/vendor/ref are recorded + shown; a file-attachment for the quote itself folds into the recipient-signature/attachment work.

### Remaining ✗ (need a decision / bigger build)
1. **Recipient sign-off at trip end** (ผู้รับบริการเซ็นยืนยัน) — app uses star eval.
2. **LESS document round-trip.**
3. **Clerk-authorization records (บันทึกข้อความ) + ศูนย์/หน่วย org levels** — departments only.
4. **1/2/3-approver chain by zone/time** — conflicts with your APPROVER-removal decision.
5. **Grab-style saved places** — you removed this on purpose (templates kept).

### Conflicts with your own standing decisions (diagram older than the decision?)
- **1/2/3-approver chain by zone/time** vs. "APPROVER role removed — admins approve" (your 2026-06-30 call).
- **Grab-style saved places** vs. your removal of SavedPlace (templates kept instead).
- **Auto distance from Google Maps** vs. the no-API-cost decision (manual km).
