import { describe, expect, it } from "vitest";
import { bookingToFormFields, fitFontSize, fillVehicleForm, type OfficialFormBooking } from "./official-form";

// Minimal booking factory — only the fields the mapper reads.
function makeBooking(over: Partial<OfficialFormBooking> = {}): OfficialFormBooking {
  const base = {
    id: "b1",
    jobNumber: "J-001",
    status: "APPROVED",
    destination: "โรงพยาบาลจุฬาลงกรณ์",
    province: "กรุงเทพมหานคร",
    purpose: "ประชุมวิชาการ",
    passengerCount: 12,
    startAt: new Date("2026-08-10T09:30:00"),
    endAt: new Date("2026-08-10T16:00:00"),
    pickupLocation: "หน้าอาคารอานันทมหิดล",
    pickupReturnTime: "15:30",
    waitAtDestination: true,
    returnTrip: true,
    coordinatorName: "สมชาย",
    coordinatorPhone: "0812345678",
    passengerNotes: "หมายเหตุ",
    notes: null,
    ajarnName: null,
    ajarnPhone: null,
    ajarnEmail: null,
    decidedAt: new Date("2026-08-01T10:00:00"),
    denialReason: null,
    requester: { name: "นายสุรพงษ์ ไชยเสนา", phone: "0899999999", email: "a@b.c" },
    department: { nameTh: "ภาควิชาอายุรศาสตร์" },
    vehicle: { registrationNumber: "1นซ 4197 กรุงเทพมหานคร", type: "VAN" },
    primaryDriver: null,
    trip: null,
    approverName: "หัวหน้าภาควิชา",
  } as unknown as OfficialFormBooking;
  return { ...base, ...over };
}

describe("bookingToFormFields", () => {
  it("maps the request block + Buddhist-era travel date", () => {
    const { text } = makeBooking() && bookingToFormFields(makeBooking());
    expect(text.fill_1).toBe("นายสุรพงษ์ ไชยเสนา");
    expect(text.fill_2).toBe("ภาควิชาอายุรศาสตร์");
    expect(text.fill_5).toBe("โรงพยาบาลจุฬาลงกรณ์");
    expect(text.Text17).toBe("12");
    // 2026 CE -> 2569 BE, Aug -> 08, day 10, 09:30–16:00
    expect(text["Date12_es_:signer:date"]).toBe("2569");
    expect(text["Date10_es_:signer:date"]).toBe("08");
    expect(text["Date11_es_:signer:date"]).toBe("10");
    expect(text["Date13_es_:signer:date"]).toBe("09:30");
    expect(text["Date14_es_:signer:date"]).toBe("16:00");
  });

  it("ticks คอย when waiting, ไม่คอย when not", () => {
    expect(bookingToFormFields(makeBooking({ waitAtDestination: true })).checks).toContain("toggle_1");
    expect(bookingToFormFields(makeBooking({ waitAtDestination: false })).checks).toContain("toggle_2");
  });

  it("ticks ให้บริการได้ for served, ไม่ได้ + reason for denied", () => {
    expect(bookingToFormFields(makeBooking({ status: "ASSIGNED" })).checks).toContain("toggle_4");
    const denied = bookingToFormFields(makeBooking({ status: "DENIED", denialReason: "รถเต็ม" }));
    expect(denied.checks).toContain("toggle_5");
    expect(denied.checks).toContain("toggle_6"); // รถเต็ม
    const other = bookingToFormFields(makeBooking({ status: "DENIED", denialReason: "งดให้บริการ" }));
    expect(other.checks).toContain("toggle_7");
    expect(other.text.undefined).toBe("งดให้บริการ");
  });

  it("maps vehicle type to the right checkbox + plate", () => {
    expect(bookingToFormFields(makeBooking()).checks).toContain("toggle_8"); // VAN
    expect(bookingToFormFields(makeBooking({ vehicle: { registrationNumber: "สธ 831", type: "SEDAN" } as never })).checks).toContain("toggle_11");
    expect(bookingToFormFields(makeBooking()).text.fill_12).toBe("1นซ 4197 กรุงเทพมหานคร");
  });

  it("fills the usage section incl. fuel type + parking when a trip exists", () => {
    const withTrip = makeBooking({
      status: "COMPLETED",
      primaryDriver: { user: { name: "น้ากอล์ฟ" } } as never,
      trip: {
        startMileage: 10000,
        endMileage: 10250,
        startedAt: new Date("2026-08-10T09:35:00"),
        endedAt: new Date("2026-08-10T16:10:00"),
        fuelType: "ดีเซล",
        fuelLiters: 45.5,
        fuelCost: 1800,
        parkingCost: 60,
        tollwayCost: 120,
      } as never,
    });
    const { text } = bookingToFormFields(withTrip);
    expect(text.Text21).toBe("ดีเซล");
    expect(text.Text20).toBe("45.5");
    expect(text.Text25).toBe("60");
    expect(text.undefined_2).toBe("น้ากอล์ฟ");
    expect(text.fill_14).toContain("10000");
  });

  it("never fills the Adobe-Sign signature fields", () => {
    const { text } = bookingToFormFields(makeBooking());
    expect(text["Signature7_es_:signer:signature"]).toBeUndefined();
    expect(text["Signature8_es_:signer:signature"]).toBeUndefined();
    expect(text["Signature9_es_:signer:signature"]).toBeUndefined();
  });
});

describe("fitFontSize (shrink-to-fit so long text doesn't overflow a field)", () => {
  // Fake measurer: width ≈ chars × size × 0.5 pt.
  const measure = (t: string, s: number) => t.length * s * 0.5;

  it("keeps the max size when the text already fits", () => {
    expect(fitFontSize("สั้น", 200, measure)).toBe(9);
  });

  it("shrinks long text to fit the field width", () => {
    const long = "x".repeat(30);
    const size = fitFontSize(long, 100, measure);
    expect(size).toBeLessThan(9);
    expect(size).toBeGreaterThanOrEqual(3.5);
    expect(measure(long, size)).toBeLessThanOrEqual(100 - 4);
  });

  it("shrinks a narrow field's long text far enough to actually fit (past the old 5.5 floor)", () => {
    // 60 chars in a 40pt box: the old fixed 5.5 floor overflowed; the exact fit is ~2.5,
    // clamped to the 3.5 absolute floor.
    const size = fitFontSize("x".repeat(60), 40, measure);
    expect(size).toBe(3.5);
  });

  it("clamps to the absolute min for pathologically long input", () => {
    expect(fitFontSize("x".repeat(500), 40, measure)).toBe(3.5);
  });

  it("honors a custom min", () => {
    expect(fitFontSize("x".repeat(30), 60, measure, { min: 6 })).toBeGreaterThanOrEqual(6);
  });
});

describe("fillVehicleForm (integration)", () => {
  it("renders a valid PDF even with very long field values (no overflow crash)", async () => {
    const bytes = await fillVehicleForm(
      makeBooking({
        purpose: "ก".repeat(200),
        destination: "โรงพยาบาลจุฬาลงกรณ์ ".repeat(20),
        passengerNotes: "หมายเหตุยาวมาก ".repeat(30),
      }),
    );
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("does NOT 500 the download when the signature image is undecodable (skips the stamp)", async () => {
    // Bogus bytes flagged as PNG → pdf-lib embedPng throws; the stamp must be
    // skipped, never fatal to the whole PDF.
    const bytes = await fillVehicleForm(makeBooking(), {
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      isPng: true,
    });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
