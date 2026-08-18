import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingForm } from "@/components/forms/booking-form";
import { PageHeader } from "@/components/page-header";
import { listDepartments } from "@/lib/departments";

/**
 * P'Top filing a booking that arrived on paper.
 *
 * The dean's office and the ผอ do not use the system: the office sends the
 * ใบขอใช้รถ afterwards, and the ผอ rings up on the morning they need the car.
 * Until this page existed there was no way to enter either — /requester/new is
 * REQUESTER-gated, and even reaching it would have filed the trip under P'Top's
 * own department.
 *
 * Same form component as the requester's, deliberately: one form, one submit
 * path, one set of field rules. The two admin powers are switched on by passing
 * `requesters` — a "book for" picker, and the backdate toggle in the date
 * picker. Everything after submission is identical, including the approval
 * queue: a backdated booking is still PENDING_APPROVAL and still has to be
 * approved, which is what keeps the paper trail honest.
 */
export default async function AdminNewBookingPage() {
  const session = await requireRole("ADMIN");
  const ta = await getTranslations("adminNewBooking");
  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");

  const [departments, me, templates, requesterRows] = await Promise.all([
    listDepartments(locale),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { departmentId: true, name: true, username: true, phone: true, email: true },
    }),
    prisma.tripTemplate.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
    }),
    // Only people who can actually own a booking: active requesters. The server
    // action re-checks this exact predicate, so the list is a convenience and
    // never the security boundary.
    prisma.user.findMany({
      where: { isActive: true, roles: { some: { role: "REQUESTER" } } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        thaiName: true,
        username: true,
        email: true,
        department: { select: { nameTh: true, nameEn: true } },
      },
    }),
  ]);

  // "ชื่อ — หน่วยงาน", because the department is the reason the picker exists:
  // two people with similar names in different offices file very different trips.
  const requesters = requesterRows.map((r) => {
    const person =
      (isThai ? r.thaiName ?? r.name : r.name ?? r.thaiName) ?? r.username ?? r.email ?? r.id;
    const dept = (isThai ? r.department?.nameTh : r.department?.nameEn ?? r.department?.nameTh) ?? null;
    return { id: r.id, label: dept ? `${person} — ${dept}` : person, department: dept };
  });

  return (
    <div className="space-y-6">
      <PageHeader title={ta("title")} description={ta("description")} />
      <BookingForm
        departments={departments}
        defaultDepartmentId={me?.departmentId ?? null}
        defaultAjarnName={me?.name || me?.username || ""}
        defaultAjarnPhone={me?.phone ?? ""}
        defaultAjarnEmail={me?.email ?? ""}
        templates={templates}
        requesters={requesters}
        locale={locale}
      />
    </div>
  );
}
