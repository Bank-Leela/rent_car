import { PrismaClient, Role, VehicleType, DriverPool } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

// CR-08 seed defaults. Every seeded account gets the same temporary
// password and is flagged for forced rotation on first sign-in.
const SEED_PASSWORD = "changeme";
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

  // Fleet drivers (car = driver). The individual "seed-user-driver" demo login
  // was removed — drivers sign in only at the shared station kiosk — so all six
  // cars pair to these six fleet drivers.
  const extraDrivers = [
    { id: "seed-driver-2", email: "driver2@chula.ac.th", name: "สมชาย ใจดี", pool: DriverPool.PUBLIC, licenseNumber: "DL-0002" },
    { id: "seed-driver-3", email: "driver3@chula.ac.th", name: "วิชัย รักงาน", pool: DriverPool.PUBLIC, licenseNumber: "DL-0003" },
    { id: "seed-driver-4", email: "driver4@chula.ac.th", name: "ประยุทธ ขับดี", pool: DriverPool.PUBLIC, licenseNumber: "DL-0004" },
    { id: "seed-driver-5", email: "driver5@chula.ac.th", name: "สุชาติ มั่นคง", pool: DriverPool.PUBLIC, licenseNumber: "DL-0005" },
    { id: "seed-driver-6", email: "driver6@chula.ac.th", name: "ธีระ สมบูรณ์", pool: DriverPool.PUBLIC, licenseNumber: "DL-0006" },
    { id: "seed-driver-7", email: "driver7@chula.ac.th", name: "อนุชา เพชรรัตน์", pool: DriverPool.PUBLIC, licenseNumber: "DL-0007" },
  ];
  for (const d of extraDrivers) {
    const username = d.email.split("@")[0]!;
    const u = await prisma.user.upsert({
      where: { id: d.id },
      create: {
        id: d.id,
        email: d.email,
        username,
        name: d.name,
        passwordHash: seedHash,
        mustChangePassword: true,
        departmentId: dept.id,
        roles: { create: { role: Role.DRIVER } },
      },
      update: {
        name: d.name,
        username,
        passwordHash: seedHash,
      },
    });
    await prisma.driver.upsert({
      where: { userId: u.id },
      create: { userId: u.id, pool: d.pool, licenseNumber: d.licenseNumber },
      // Keep pool in sync so changes to the seed actually land in the DB.
      update: { pool: d.pool, licenseNumber: d.licenseNumber },
    });
  }

  // Six vehicles — one per driver (car = driver). Matches the fleet the admin
  // board shows (A–F by registration order).
  const vehicles = [
    { registrationNumber: "1กข-1001", type: VehicleType.SEDAN, capacity: 4 },
    { registrationNumber: "1กข-1002", type: VehicleType.VAN, capacity: 12 },
    { registrationNumber: "1กข-1003", type: VehicleType.PICKUP, capacity: 5 },
    { registrationNumber: "รถเวร-904", type: VehicleType.SEDAN, capacity: 4 },
    { registrationNumber: "รถเวร-905", type: VehicleType.VAN, capacity: 12 },
    { registrationNumber: "รถเวร-906", type: VehicleType.PICKUP, capacity: 5 },
  ];

  for (const v of vehicles) {
    await prisma.vehicle.upsert({
      where: { registrationNumber: v.registrationNumber },
      create: v,
      update: {},
    });
  }

  // car = driver: pair each car (board order = registrationNumber asc, the same
  // ordering the admin board labels A, B, C…) to one driver, and give that driver
  // the matching login driverA..driverF. So `db seed` alone reproduces the A–F
  // fleet + per-car driver logins (no need to also run ensure-fleet / pair-cars).
  const fleet = await prisma.vehicle.findMany({
    where: { isActive: true },
    orderBy: { registrationNumber: "asc" },
    select: { id: true },
  });
  // Driver user ids, in the order they pair to cars A, B, C, D, E, F.
  const driverUserIdsByCar = [
    "seed-driver-4", // ประยุทธ ขับดี
    "seed-driver-5", // สุชาติ มั่นคง
    "seed-driver-6", // ธีระ สมบูรณ์
    "seed-driver-7", // อนุชา เพชรรัตน์
    "seed-driver-2", // สมชาย ใจดี
    "seed-driver-3", // วิชัย รักงาน
  ];
  if (fleet.length !== driverUserIdsByCar.length) {
    const extra = Math.abs(fleet.length - driverUserIdsByCar.length);
    const kind = fleet.length > driverUserIdsByCar.length ? "car(s)" : "driver(s)";
    console.warn(
      `[seed] fleet (${fleet.length}) and driver list (${driverUserIdsByCar.length}) differ — ${extra} ${kind} left unpaired. Keep the arrays in sync.`,
    );
  }
  for (let i = 0; i < fleet.length && i < driverUserIdsByCar.length; i++) {
    const letter = String.fromCharCode(65 + i); // A, B, C…
    const userId = driverUserIdsByCar[i]!;
    const drv = await prisma.driver.findUnique({ where: { userId }, select: { id: true } });
    if (!drv) continue;
    await prisma.vehicle.update({ where: { id: fleet[i]!.id }, data: { assignedDriverId: drv.id } });
    // driverA..driverF — the per-car driver login (password = the seed default).
    await prisma.user.update({ where: { id: userId }, data: { username: `driver${letter}` } });
  }

  console.log("Seed complete:", {
    departments: await prisma.department.count(),
    users: await prisma.user.count(),
    drivers: await prisma.driver.count(),
    vehicles: await prisma.vehicle.count(),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
