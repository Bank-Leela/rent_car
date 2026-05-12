import { PrismaClient, Role, VehicleType, DriverPool } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Departments
  const dept = await prisma.department.upsert({
    where: { id: "seed-dept-medicine" },
    create: {
      id: "seed-dept-medicine",
      nameEn: "Faculty of Medicine",
      nameTh: "คณะแพทยศาสตร์",
    },
    update: {},
  });

  // One user per role.
  const users = [
    { id: "seed-user-requester", email: "requester@chula.ac.th", name: "อรวรรณ พิทักษ์ชัย", role: Role.REQUESTER },
    { id: "seed-user-approver", email: "approver@chula.ac.th", name: "ศาสตราจารย์ ดร. ธนากร ศรีสุวรรณ", role: Role.APPROVER },
    { id: "seed-user-admin", email: "admin@chula.ac.th", name: "ปิยะ วงศ์สวัสดิ์", role: Role.ADMIN },
    { id: "seed-user-driver", email: "driver@chula.ac.th", name: "อนุชา เพชรรัตน์", role: Role.DRIVER },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        departmentId: dept.id,
        roles: { create: { role: u.role } },
      },
      update: {
        name: u.name,
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

  // Make the approver the head of the seed department.
  await prisma.department.update({
    where: { id: dept.id },
    data: { headUserId: "seed-user-approver" },
  });

  // Driver profile for the impersonatable driver user
  await prisma.driver.upsert({
    where: { userId: "seed-user-driver" },
    create: {
      userId: "seed-user-driver",
      pool: DriverPool.PUBLIC,
      licenseNumber: "DL-0001",
    },
    update: {},
  });

  // 5 public drivers per the plan. Private pool not yet confirmed by the
  // client — leave it out until we know.
  const extraDrivers = [
    { id: "seed-driver-2", email: "driver2@chula.ac.th", name: "สมชาย ใจดี", pool: DriverPool.PUBLIC, licenseNumber: "DL-0002" },
    { id: "seed-driver-3", email: "driver3@chula.ac.th", name: "วิชัย รักงาน", pool: DriverPool.PUBLIC, licenseNumber: "DL-0003" },
    { id: "seed-driver-4", email: "driver4@chula.ac.th", name: "ประยุทธ ขับดี", pool: DriverPool.PUBLIC, licenseNumber: "DL-0004" },
    { id: "seed-driver-5", email: "driver5@chula.ac.th", name: "สุชาติ มั่นคง", pool: DriverPool.PUBLIC, licenseNumber: "DL-0005" },
  ];
  for (const d of extraDrivers) {
    const u = await prisma.user.upsert({
      where: { id: d.id },
      create: {
        id: d.id,
        email: d.email,
        name: d.name,
        departmentId: dept.id,
        roles: { create: { role: Role.DRIVER } },
      },
      update: { name: d.name },
    });
    await prisma.driver.upsert({
      where: { userId: u.id },
      create: { userId: u.id, pool: d.pool, licenseNumber: d.licenseNumber },
      // Keep pool in sync so changes to the seed actually land in the DB.
      update: { pool: d.pool, licenseNumber: d.licenseNumber },
    });
  }

  // A couple of vehicles
  const vehicles = [
    { registrationNumber: "1กข-1001", type: VehicleType.SEDAN, capacity: 4 },
    { registrationNumber: "1กข-1002", type: VehicleType.VAN, capacity: 12 },
    { registrationNumber: "1กข-1003", type: VehicleType.PICKUP, capacity: 5 },
  ];

  for (const v of vehicles) {
    await prisma.vehicle.upsert({
      where: { registrationNumber: v.registrationNumber },
      create: v,
      update: {},
    });
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
