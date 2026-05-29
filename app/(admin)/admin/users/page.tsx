import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CreateUserForm } from "@/components/forms/create-user-form";
import { UserRow } from "@/components/forms/admin-user-row";

export default async function AdminUsersPage() {
  await requireRole("ADMIN");
  const t = await getTranslations("adminUsers");

  const [users, departments] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { roles: true, department: true },
    }),
    prisma.department.findMany({ orderBy: { nameEn: "asc" } }),
  ]);

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
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("emptyList")}</p>
          ) : (
            <ul className="divide-y">
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={{
                    id: u.id,
                    email: u.email,
                    username: u.username,
                    name: u.name,
                    thaiName: u.thaiName,
                    department: u.department?.nameEn ?? null,
                    roles: u.roles.map((r) => r.role),
                    isActive: u.isActive,
                    mustChangePassword: u.mustChangePassword,
                  }}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
