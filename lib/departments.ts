import { prisma } from "@/lib/db";
import { isThaiLocale } from "@/i18n/config";

// Departments for pickers, sorted by the name the user will actually read.
export function listDepartments(locale: string) {
  return prisma.department.findMany({
    orderBy: isThaiLocale(locale) ? ({ nameTh: "asc" } as const) : ({ nameEn: "asc" } as const),
    select: { id: true, nameEn: true, nameTh: true },
  });
}
