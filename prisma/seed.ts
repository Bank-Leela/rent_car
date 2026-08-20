import { PrismaClient, Role, VehicleType, DriverPool } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

// Every seeded account gets ONE temporary password and is flagged for forced
// rotation on first sign-in.
//
// It used to be the literal "changeme", hardcoded here and printed in tracked
// SETUP.md — i.e. published. The deploy runbook tells the operator to run
// `prisma db seed` on the production box, so a fresh install shipped with a
// world-readable admin password and nothing in the go-live checklist telling
// anyone to change it.
//
// Now: SEED_PASSWORD from the environment if set (so a scripted install can
// choose one), otherwise a random 24-char secret generated per run and printed
// ONCE at the end. Nothing that reaches the repo is a credential.
// Setting SEED_PASSWORD to something SHORTER than 8 characters used to be an
// unrecoverable lockout: the length guard fell through to a random password while
// the "was it generated" flag tested only whether the variable was SET — so the
// print block was suppressed and all nine accounts ended up with a password nobody
// had ever seen. Refuse loudly instead; the operator is right there in the terminal.
if (process.env.SEED_PASSWORD && process.env.SEED_PASSWORD.length < 8) {
  console.error(
    "\nSEED_PASSWORD must be at least 8 characters. Nothing was seeded.\n" +
      "Either pass a longer one, or unset it and let the seed generate one for you.\n",
  );
  process.exit(1);
}
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? randomBytes(18).toString("base64url");
const SEED_PASSWORD_GENERATED = !process.env.SEED_PASSWORD;
let SEED_PASSWORD_HASH: string | null = null;
async function getSeedPasswordHash(): Promise<string> {
  if (!SEED_PASSWORD_HASH) SEED_PASSWORD_HASH = await hash(SEED_PASSWORD, 12);
  return SEED_PASSWORD_HASH;
}

async function main() {
  // All 35 units that share the faculty fleet: 12 administrative "งาน" units
  // and 23 academic "ภาควิชา" departments. seed-dept-medicine is kept as the
  // requester's home department for dev impersonation continuity.
  const departments: Array<{ id: string; nameEn: string; nameTh: string }> = [
    { id: "seed-dept-medicine", nameEn: "Department of Internal Medicine", nameTh: "ภาควิชาอายุรศาสตร์" },
    { id: "seed-dept-academic-services", nameEn: "Academic Services & International Education", nameTh: "งานการบริการวิชาการและการศึกษานานาชาติ" },
    { id: "seed-dept-student-affairs", nameEn: "Student Affairs", nameTh: "งานกิจการนิสิต" },
    { id: "seed-dept-infrastructure-it", nameEn: "Infrastructure & IT Systems", nameTh: "งานโครงสร้างพื้นฐานและระบบเทคโนโลยีสารสนเทศ" },
    { id: "seed-dept-administration", nameEn: "Administration", nameTh: "งานบริหาร" },
    { id: "seed-dept-graduate-studies", nameEn: "Graduate Studies", nameTh: "งานบัณฑิตศึกษา" },
    { id: "seed-dept-quality-development", nameEn: "Educational Quality & Organizational Development", nameTh: "งานพัฒนาคุณภาพการศึกษาและองค์กร" },
    { id: "seed-dept-strategy", nameEn: "Organizational Strategy", nameTh: "งานยุทธศาสตร์องค์กร" },
    { id: "seed-dept-physical-systems", nameEn: "Physical Systems", nameTh: "งานระบบกายภาพ" },
    { id: "seed-dept-research-innovation", nameEn: "Research & Deep Innovation", nameTh: "งานวิจัยและนวัตกรรมเชิงลึก" },
    { id: "seed-dept-academic-affairs", nameEn: "Academic Affairs", nameTh: "งานวิชาการ" },
    { id: "seed-dept-international-affairs", nameEn: "International Affairs", nameTh: "งานวิรัชกิจ" },
    { id: "seed-dept-digital-innovation", nameEn: "Integrative Innovation & Digital Technology", nameTh: "งานนวัตกรรมแนวบูรณาการและเทคโนโลยีดิจิทัล" },
    { id: "seed-dept-anatomy", nameEn: "Department of Anatomy", nameTh: "ภาควิชากายวิภาคศาสตร์" },
    { id: "seed-dept-pediatrics", nameEn: "Department of Pediatrics", nameTh: "ภาควิชากุมารเวชศาสตร์" },
    { id: "seed-dept-ophthalmology", nameEn: "Department of Ophthalmology", nameTh: "ภาควิชาจักษุวิทยา" },
    { id: "seed-dept-psychiatry", nameEn: "Department of Psychiatry", nameTh: "ภาควิชาจิตเวชศาสตร์" },
    { id: "seed-dept-microbiology", nameEn: "Department of Microbiology", nameTh: "ภาควิชาจุลชีววิทยา" },
    { id: "seed-dept-biochemistry", nameEn: "Department of Biochemistry", nameTh: "ภาควิชาชีวเคมี" },
    { id: "seed-dept-forensic", nameEn: "Department of Forensic Medicine", nameTh: "ภาควิชานิติเวชศาสตร์" },
    { id: "seed-dept-parasitology", nameEn: "Department of Parasitology", nameTh: "ภาควิชาปรสิตวิทยา" },
    { id: "seed-dept-pathology", nameEn: "Department of Pathology", nameTh: "ภาควิชาพยาธิวิทยา" },
    { id: "seed-dept-pharmacology", nameEn: "Department of Pharmacology", nameTh: "ภาควิชาเภสัชวิทยา" },
    { id: "seed-dept-radiology", nameEn: "Department of Radiology", nameTh: "ภาควิชารังสีวิทยา" },
    { id: "seed-dept-anesthesiology", nameEn: "Department of Anesthesiology", nameTh: "ภาควิชาวิสัญญีวิทยา" },
    { id: "seed-dept-laboratory-medicine", nameEn: "Department of Laboratory Medicine", nameTh: "ภาควิชาเวชศาสตร์ชันสูตร" },
    { id: "seed-dept-preventive-social", nameEn: "Department of Preventive & Social Medicine", nameTh: "ภาควิชาเวชศาสตร์ป้องกันและสังคม" },
    { id: "seed-dept-rehab", nameEn: "Department of Rehabilitation Medicine", nameTh: "ภาควิชาเวชศาสตร์ฟื้นฟู" },
    { id: "seed-dept-surgery", nameEn: "Department of Surgery", nameTh: "ภาควิชาศัลยศาสตร์" },
    { id: "seed-dept-physiology", nameEn: "Department of Physiology", nameTh: "ภาควิชาสรีรวิทยา" },
    { id: "seed-dept-ob-gyn", nameEn: "Department of Obstetrics & Gynecology", nameTh: "ภาควิชาสูติศาสตร์-นรีเวชวิทยา" },
    { id: "seed-dept-otolaryngology", nameEn: "Department of Otolaryngology", nameTh: "ภาควิชาโสต ศอ นาสิกวิทยา" },
    { id: "seed-dept-orthopedics", nameEn: "Department of Orthopedics", nameTh: "ภาควิชาออร์โธปิดิกส์" },
    { id: "seed-dept-emergency", nameEn: "Department of Emergency Medicine", nameTh: "ภาควิชาเวชศาสตร์ฉุกเฉิน" },
    { id: "seed-dept-family-medicine", nameEn: "Department of Family Medicine", nameTh: "ภาควิชาเวชศาสตร์ครอบครัว" },
  ];
  for (const d of departments) {
    await prisma.department.upsert({
      where: { id: d.id },
      create: d,
      update: { nameEn: d.nameEn, nameTh: d.nameTh },
    });
  }
  const dept = await prisma.department.findUniqueOrThrow({ where: { id: "seed-dept-medicine" } });

  // One user per role.
  const users = [
    { id: "seed-user-requester", email: "requester@chula.ac.th", name: "อรวรรณ พิทักษ์ชัย", role: Role.REQUESTER },
    { id: "seed-user-admin", email: "admin@chula.ac.th", name: "ปิยะ วงศ์สวัสดิ์", role: Role.ADMIN },
    // Shared "driver station" login (one account all drivers use on the shared
    // device). DRIVER role but NO Driver profile — it's a login, not a car-paired
    // driver; the schedule board it opens shows ALL cars.
    { id: "seed-user-driverstation", email: "driverstation@chula.ac.th", name: "สถานีคนขับ (ใช้ร่วมกัน)", role: Role.DRIVER },
  ];

  const seedHash = await getSeedPasswordHash();
  for (const u of users) {
    const username = u.email.split("@")[0]!;
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        email: u.email,
        username,
        name: u.name,
        passwordHash: seedHash,
        mustChangePassword: true,
        departmentId: dept.id,
        roles: { create: { role: u.role } },
      },
      update: {
        name: u.name,
        username,
        passwordHash: seedHash,
        roles: {
          upsert: {
            where: { userId_role: { userId: u.id, role: u.role } },
            create: { role: u.role },
            update: {},
          },
        },
      },
    });
  }

  // The requester is the designated booking representative for the seed
  // department (change request 01). headUserId is intentionally left unset:
  // approval is no longer per-department but routed to the fleet-section
  // head (anyone holding APPROVER role).
  await prisma.department.update({
    where: { id: dept.id },
    data: { representativeUserId: "seed-user-requester" },
  });

  // Fleet drivers (car = driver), from the faculty driver sheet. Each driver is
  // paired to their PRIMARY car; any second car is recorded in `notes` (the app's
  // car=driver model is 1:1). Drivers don't log in individually — they share the
  // station kiosk — so the username is just a stable handle. This is the full
  // roster — six drivers, six cars.
  const fleetDrivers = [
    {
      id: "seed-driver-2", email: "driver2@chula.ac.th",
      name: "สุรพงษ์ ไชยเสนา", nickname: "น้าโต", phone: "063-229-8387",
      licenseType: "ประเภท 2", licenseExpiresAt: "2028-03-30",
      position: "ลูกจ้างประจำ", retirementYear: 2569,
      car: "สธ-831", notes: "รถสำรอง: สธ-832 · ใบขับขี่ตลอดชีพ · เวรล่าสุด: พชร.ส่วนกลาง",
    },
    {
      id: "seed-driver-3", email: "driver3@chula.ac.th",
      name: "สันติ ฉายยางโทน", nickname: "น้าติ", phone: "086-090-7709",
      licenseType: "ประเภท 2", licenseExpiresAt: "2026-03-26",
      position: "ลูกจ้างประจำ", retirementYear: 2569,
      car: "สษ-6692", notes: "ใบขับขี่ตลอดชีพ · เวรล่าสุด: พชร.ส่วนกลาง",
    },
    {
      id: "seed-driver-4", email: "driver4@chula.ac.th",
      name: "บุญชู พรมรักษ์", nickname: "น้าชู", phone: "089-226-9827",
      licenseType: "ประเภท 2", licenseExpiresAt: "2033-11-03",
      position: "ลูกจ้างประจำ", retirementYear: 2570,
      car: "อ-5098", notes: "รถสำรอง: 1นซ-4198 · ใบขับขี่ตลอดชีพ · เวรล่าสุด: พชร.คณบดี",
    },
    {
      id: "seed-driver-5", email: "driver5@chula.ac.th",
      name: "วินัย จุ้ยสม", nickname: "น้าวินัย", phone: "089-025-0109",
      licenseType: "ประเภท 2", licenseExpiresAt: "2028-08-21",
      position: "ลูกจ้างประจำ", retirementYear: 2573,
      car: "41-6224", notes: "รถสำรอง: สษ-34 · ใบขับขี่ตลอดชีพ · เวรล่าสุด: พชร.ส่วนกลาง",
    },
    {
      id: "seed-driver-6", email: "driver6@chula.ac.th",
      name: "นฤทธิ์ สุกสุด", nickname: "พี่กอล์ฟ", phone: "087-986-3879",
      licenseType: null, licenseExpiresAt: null,
      position: "ลูกจ้างประจำ", retirementYear: 2579,
      car: "1นซ-4197", notes: "ใบขับขี่ตลอดชีพ · เวรล่าสุด: พชร.ส่วนกลาง",
    },
    {
      id: "seed-driver-7", email: "driver7@chula.ac.th",
      name: "ลหัส เจริญสุข", nickname: "พี่รง", phone: "086-093-4682",
      licenseType: "ประเภท 2", licenseExpiresAt: "2028-08-21",
      position: "พนักงานมหาวิทยาลัย", retirementYear: 2581,
      car: "1ผผ-1932", notes: "รถสำรอง: อฉ-371 · เวรล่าสุด: พชร.ส่วนกลาง",
    },
  ];
  const rosterPlates = fleetDrivers.map((d) => d.car);

  // Real cars — the drivers' primary plates. Type/capacity aren't on the sheet;
  // SEDAN/4 as a placeholder until confirmed.
  for (const plate of rosterPlates) {
    await prisma.vehicle.upsert({
      where: { registrationNumber: plate },
      create: { registrationNumber: plate, type: VehicleType.SEDAN, capacity: 4 },
      update: {},
    });
  }
  // Idempotent re-pair: clear every pairing first (so changing plates never trips
  // the assignedDriverId @unique), then retire any car not on the current roster.
  await prisma.vehicle.updateMany({ data: { assignedDriverId: null } });
  await prisma.vehicle.updateMany({
    where: { registrationNumber: { notIn: rosterPlates } },
    data: { isActive: false },
  });

  for (const d of fleetDrivers) {
    const username = d.email.split("@")[0]!;
    const u = await prisma.user.upsert({
      where: { id: d.id },
      create: {
        id: d.id,
        email: d.email,
        username,
        name: d.name,
        phone: d.phone,
        passwordHash: seedHash,
        mustChangePassword: true,
        departmentId: dept.id,
        roles: { create: { role: Role.DRIVER } },
      },
      update: { name: d.name, phone: d.phone, username },
    });
    const driver = await prisma.driver.upsert({
      where: { userId: u.id },
      create: {
        userId: u.id,
        pool: DriverPool.PUBLIC,
        licenseNumber: null,
        nickname: d.nickname,
        licenseType: d.licenseType,
        licenseExpiresAt: d.licenseExpiresAt ? new Date(d.licenseExpiresAt) : null,
        position: d.position,
        retirementYear: d.retirementYear,
        notes: d.notes,
      },
      update: {
        pool: DriverPool.PUBLIC,
        nickname: d.nickname,
        licenseType: d.licenseType,
        licenseExpiresAt: d.licenseExpiresAt ? new Date(d.licenseExpiresAt) : null,
        position: d.position,
        retirementYear: d.retirementYear,
        notes: d.notes,
      },
    });
    // car = driver (1:1): pair this driver to their own car.
    await prisma.vehicle.update({
      where: { registrationNumber: d.car },
      data: { assignedDriverId: driver.id, isActive: true },
    });
  }

  console.log("Seed complete:", {
    departments: await prisma.department.count(),
    users: await prisma.user.count(),
    drivers: await prisma.driver.count(),
    vehicles: await prisma.vehicle.count(),
  });

  // Printed once, here, and nowhere else — not committed, not in SETUP.md, not
  // recoverable later. Every seeded account has mustChangePassword set, so this
  // only has to survive long enough for the first sign-in.
  if (SEED_PASSWORD_GENERATED) {
    console.log(
      [
        "",
        `  ┌${"─".repeat(60)}┐`,
        `  │${" TEMPORARY PASSWORD for every seeded account".padEnd(60)}│`,
        `  └${"─".repeat(60)}┘`,
        "",
        `      ${SEED_PASSWORD}`,
        "",
        "  Shown once, here only — it is not stored and cannot be recovered.",
        "  Sign in, change it, then change the other seeded accounts from",
        "  /admin/users. Set SEED_PASSWORD in the environment to choose your own.",
        "",
      ].join("\n"),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
