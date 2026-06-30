"use client";

import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { ListSearch } from "@/components/list-search";
import { EmptyState } from "@/components/empty-state";
import { UserRow } from "@/components/forms/admin-user-row";

interface AdminUserListRow {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  thaiName: string | null;
  department: string | null;
  roles: string[];
  isActive: boolean;
  mustChangePassword: boolean;
}

export function UsersListClient({ users }: { users: AdminUserListRow[] }) {
  const t = useTranslations("listSearch");
  return (
    <ListSearch
      items={users}
      keys={["name", "email"]}
      render={(rows) =>
        rows.length === 0 ? (
          <EmptyState icon={Users} title={t("noMatches")} />
        ) : (
          <ul className="divide-y">
            {rows.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
          </ul>
        )
      }
    />
  );
}
