import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, type PDFForm, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Booking, Department, Trip, User, Vehicle, VehicleType } from "@prisma/client";

// The official faculty form is a real AcroForm (57 fields) prepared with Adobe
// Acrobat Sign signer tags. We fill the data fields and leave the three
// Signature*_es_:signer:signature fields empty + fillable for the e-sign step.
const TEMPLATE = "2 แบบฟอร์มขออนุมัติใช้ยานพาหนะ คณะแพทยศาส e.pdf";
const FONT = "NotoSansThai-Regular.ttf";

export type OfficialFormBooking = Booking & {
  requester: User;
  department: Department | null;
  vehicle: Vehicle | null;
  primaryDriver: { user: User } | null;
  trip: Trip | null;
  approverName?: string | null;
  denialReason?: string | null;
};

// Thai Buddhist-era year (พ.ศ. = ค.ศ. + 543).
const beYear = (d: Date) => d.getFullYear() + 543;
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dec = (v: unknown) => (v == null ? "" : String(v));

// Which vehicle-type checkbox: รถตู้ / รถ6ล้อ / รถกระบะ / รถเก๋ง(คณบดี).
const TYPE_TOGGLE: Record<VehicleType, string> = {
  VAN: "toggle_8",
  // No 6-wheel enum today; OTHER maps to the 6-wheel box on the form.
  OTHER: "toggle_9",
  PICKUP: "toggle_10",
  SEDAN: "toggle_11",
};

// Pure mapper (unit-tested): booking → { textFields, checkedBoxes }. Keeps the
// field-name knowledge in one place, separate from the pdf-lib I/O.
export function bookingToFormFields(b: OfficialFormBooking): {
  text: Record<string, string>;
  checks: string[];
} {
  const now = new Date();
  const text: Record<string, string> = {};
  const checks: string[] = [];

  // ---- Request ----
  text.fill_1 = b.requester.name ?? b.ajarnName ?? "";
  text.fill_2 = b.department?.nameTh ?? "";
  text.fill_3 = b.requester.phone ?? b.ajarnPhone ?? "";
  text.EMail = b.requester.email ?? b.ajarnEmail ?? "";
  text.fill_5 = b.destination;
  text.fill_6 = b.province;
  text.fill_7 = b.purpose;
  text.Text17 = String(b.passengerCount);
  // Travel date + times (real field names carry the Adobe-Sign signer tag).
  text["Date11_es_:signer:date"] = pad(b.startAt.getDate());
  text["Date10_es_:signer:date"] = pad(b.startAt.getMonth() + 1);
  text["Date12_es_:signer:date"] = String(beYear(b.startAt));
  text["Date13_es_:signer:date"] = hhmm(b.startAt);
  text["Date14_es_:signer:date"] = hhmm(b.endAt);
  text.Text18 = b.pickupLocation ?? "";
  text.Text22 = b.pickupReturnTime ?? "";
  if (b.waitAtDestination) checks.push("toggle_1");
  else checks.push("toggle_2");
  if (b.returnTrip && b.pickupReturnTime) {
    checks.push("toggle_3");
    text.Text19 = b.pickupReturnTime;
  }
  text.fill_8 = b.coordinatorName ?? "";
  text.fill_9 = b.coordinatorPhone ?? "";
  text.fill_10 = b.passengerNotes ?? "";
  // Form (submission) date, top of sheet.
  text["Date26_es_:signer:date"] = pad(now.getDate());
  text["Date16_es_:signer:date"] = pad(now.getMonth() + 1);
  text["Date15_es_:signer:date"] = String(beYear(now));

  // ---- Approval ----
  const served = ["APPROVED", "ASSIGNED", "COMPLETED", "OUTSOURCED"].includes(b.status);
  const denied = b.status === "DENIED";
  if (served) checks.push("toggle_4");
  if (denied) {
    checks.push("toggle_5");
    const reason = b.denialReason ?? "";
    if (/เต็ม|full/i.test(reason)) checks.push("toggle_6");
    else if (reason) {
      checks.push("toggle_7");
      text.undefined = reason;
    }
  }
  if (b.approverName) text.fill_17 = b.approverName;
  if (b.decidedAt) text.fill_18 = `${pad(b.decidedAt.getDate())}/${pad(b.decidedAt.getMonth() + 1)}/${beYear(b.decidedAt)}`;

  // ---- Driver usage (fills after dispatch / trip) ----
  if (b.vehicle) {
    const plate = b.vehicle.registrationNumber;
    text.fill_12 = plate;
    // Thai plates read "กข 1234 <province>"; province segment when present.
    const parts = plate.trim().split(/\s+/);
    if (parts.length > 2) text.fill_13 = parts.slice(2).join(" ");
    const toggle = TYPE_TOGGLE[b.vehicle.type];
    if (toggle) checks.push(toggle);
  }
  const trip = b.trip;
  if (trip) {
    text.fill_14 = `${trip.startMileage} · ${hhmm(trip.startedAt)}`;
    if (trip.endedAt) text.fill_15 = hhmm(trip.endedAt);
    if (trip.fuelType) text.Text21 = trip.fuelType;
    text.Text20 = dec(trip.fuelLiters);
    text.Text23 = dec(trip.fuelCost);
    text.Text24 = dec(trip.tollwayCost);
    text.Text25 = dec(trip.parkingCost);
    if (b.primaryDriver) text.undefined_2 = b.primaryDriver.user.name ?? "";
    if (trip.endedAt) text.fill_20 = `${pad(trip.endedAt.getDate())}/${pad(trip.endedAt.getMonth() + 1)}/${beYear(trip.endedAt)}`;
    // Recipient (out-of-hours) section: trip window.
    text.Text5 = hhmm(trip.startedAt);
    if (trip.endedAt) text.Text6 = hhmm(trip.endedAt);
  }
  text.fill_21 = b.requester.name ?? "";

  return { text, checks };
}

const MAX_FONT = 9;
// Absolute floor — tiny but CONTAINED beats overflowing the box. Only reached by
// pathologically long input; realistic values land well above it (e.g. an 89-char
// destination in a 175pt box → ~4pt; a 135-char purpose in 331pt → ~5.5pt).
const MIN_FONT = 3.5;
const FIELD_INSET = 4; // ~2pt left + right padding inside an AcroForm field box

// Largest size (≤ max) at which `measure(value, size)` fits `widthPts` minus the
// insets. Pure + unit-tested. Glyph widths scale linearly with font size, so the
// exact fitting size is `avail / (width-per-1pt)` — computed directly (no floor
// that would leave text overflowing) and only clamped to an absolute min. Thai has
// no inter-word spaces, so shrinking a single line to fit width is the reliable
// way to stop text overflowing its field box.
export function fitFontSize(
  value: string,
  widthPts: number,
  measure: (text: string, size: number) => number,
  opts: { max?: number; min?: number } = {},
): number {
  const max = opts.max ?? MAX_FONT;
  const min = opts.min ?? MIN_FONT;
  const avail = Math.max(1, widthPts - FIELD_INSET);
  const perPt = measure(value, 1);
  if (perPt <= 0) return max;
  // Round DOWN to 0.5 so the chosen size definitely fits; clamp to [min, max].
  const fit = Math.floor(Math.min(max, avail / perPt) * 2) / 2;
  return Math.max(min, fit);
}

// The field's widget box (points), or null when it can't be read.
function fieldBox(f: ReturnType<PDFForm["getTextField"]>): { width: number; height: number } | null {
  try {
    const r = f.acroField.getWidgets()[0]?.getRectangle();
    return r && r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : null;
  } catch {
    return null;
  }
}

function setText(form: PDFForm, name: string, value: string, font: PDFFont) {
  if (!value) return;
  try {
    const f = form.getTextField(name);
    f.setText(value);
    const measure = (t: string, s: number) => font.widthOfTextAtSize(t, s);
    let size = MAX_FONT;
    const box = fieldBox(f);
    if (box) {
      const words = value.trim().split(/\s+/);
      if (box.height > 16 && words.length > 1) {
        // Tall, space-delimited box (e.g. an English note/reason): let it wrap,
        // and only shrink if the single widest word still overflows the width.
        f.enableMultiline();
        const widest = words.reduce((a, b) => (measure(b, MAX_FONT) > measure(a, MAX_FONT) ? b : a));
        size = fitFontSize(widest, box.width, measure, { min: 6 });
      } else {
        // Single line (Thai has no word breaks): shrink the whole string to fit.
        size = fitFontSize(value, box.width, measure);
      }
    }
    f.setFontSize(size);
    f.updateAppearances(font);
  } catch {
    /* field renamed / absent — never 500 the download */
  }
}

function check(form: PDFForm, name: string) {
  try {
    form.getCheckBox(name).check();
  } catch {
    /* absent */
  }
}

// Render the filled official form. Signature fields are never touched — they
// stay live for Adobe Sign.
export async function fillVehicleForm(b: OfficialFormBooking): Promise<Uint8Array> {
  const [tplBytes, fontBytes] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "public", TEMPLATE)),
    fs.readFile(path.join(process.cwd(), "lib", "pdf", "fonts", FONT)),
  ]);
  const doc = await PDFDocument.load(tplBytes, { updateMetadata: false });
  doc.registerFontkit(fontkit);
  const thai = await doc.embedFont(fontBytes, { subset: true });
  const form = doc.getForm();

  const { text, checks } = bookingToFormFields(b);
  for (const [name, value] of Object.entries(text)) setText(form, name, value, thai);
  for (const name of checks) check(form, name);

  return doc.save();
}
