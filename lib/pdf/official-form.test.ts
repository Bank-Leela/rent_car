import { describe, expect, it } from "vitest";
import { bookingToFormFields, type OfficialFormBooking } from "./official-form";

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
