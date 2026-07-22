import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, type PDFForm, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Booking, Department, Trip, User, Vehicle, VehicleType } from "@prisma/client";

// The official faculty form is a real AcroForm (57 fields). We fill the data
// fields and stamp the requester's registered signature image over the first
// Signature*_es_:signer:signature field (physically positioned right after
// the request section — the requester's own signature block). The other two
// signature fields stay blank; the department head and driver still sign the
// printed copy by hand.
const TEMPLATE = "2 แบบฟอร์มขออนุมัติใช้ยานพาหนะ คณะแพทยศาส e.pdf";
const FONT = "NotoSansThai-Regular.ttf";
const REQUESTER_SIGNATURE_FIELD = "Signature7_es_:signer:signature";

export type SignatureImage = { bytes: Uint8Array; isPng: boolean };

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

function setText(form: PDFForm, name: string, value: string, font: PDFFont) {
  if (!value) return;
  try {
    const f = form.getTextField(name);
    f.setText(value);
    f.setFontSize(9);
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

// Draw the signature image into the requester's signature field's own box,
// scaled to fit (aspect preserved, centered) so it never spills into
// neighbouring fields. Silently skipped if the field is missing/renamed —
// never breaks the download over a template mismatch.
async function stampRequesterSignature(doc: PDFDocument, form: PDFForm, image: SignatureImage) {
  let field;
  try {
    field = form.getField(REQUESTER_SIGNATURE_FIELD);
  } catch {
    return;
  }
  const widget = field.acroField.getWidgets()[0];
  if (!widget) return;
  const rect = widget.getRectangle();
  const pageRef = widget.P();
  const page = doc.getPages().find((p) => p.ref === pageRef) ?? doc.getPage(0);

  const embedded = image.isPng ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
  const scale = Math.min(rect.width / embedded.width, rect.height / embedded.height);
  const w = embedded.width * scale;
  const h = embedded.height * scale;
  page.drawImage(embedded, {
    x: rect.x + (rect.width - w) / 2,
    y: rect.y + (rect.height - h) / 2,
    width: w,
    height: h,
  });
}

// Render the filled official form, stamping the requester's registered
// signature image (if any) over their signature field.
export async function fillVehicleForm(
  b: OfficialFormBooking,
  signatureImage?: SignatureImage | null,
): Promise<Uint8Array> {
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

  if (signatureImage) await stampRequesterSignature(doc, form, signatureImage);

  return doc.save();
}
