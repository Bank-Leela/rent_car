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
    { id: "seed-user-requester", email: "requester@chula.ac.th", name: "Req Tester", role: Role.REQUESTER },
    { id: "seed-user-approver", email: "approver@chula.ac.th", name: "App Rover", role: Role.APPROVER },
    { id: "seed-user-admin", email: "admin@chula.ac.th", name: "Admin Istrator", role: Role.ADMIN },
    { id: "seed-user-driver", email: "driver@chula.ac.th", name: "Drive R", role: Role.DRIVER },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        departmentId: dept.id,
        roles: { create: { role: u.role } },
      },
      update: {
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

  // Driver profile
  await prisma.driver.upsert({
    where: { userId: "seed-user-driver" },
    create: {
      userId: "seed-user-driver",
      pool: DriverPool.PUBLIC,
      licenseNumber: "DL-0001",
    },
    update: {},
  });

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
