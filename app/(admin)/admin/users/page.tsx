import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CreateUserForm } from "@/components/forms/create-user-form";
import { UsersListClient } from "@/components/admin/users-list-client";

export default async function AdminUsersPage() {
  await requireRole("ADMIN");
  const t = await getTranslations("adminUsers");

  const [users, departments] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { roles: true, department: true },
    }),
    prisma.department.findMany({ orderBy: { nameTh: "asc" } }),
  ]);

  const userRows = users.map((u) => ({
    id: u.id,
    email: u.email,
    username: u.username,
    name: u.name,
    thaiName: u.thaiName,
    department: u.department?.nameTh ?? null,
    roles: u.roles.map((r) => r.role),
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    signatureName: u.signatureName,
    hasSignature: !!u.signatureImageUrl,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("createTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateUserForm departments={departments} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {userRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("emptyList")}</p>
          ) : (
            <UsersListClient users={userRows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
