"use client";

import { useMemo, useState } from "react";
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
  signatureName: string | null;
  hasSignature: boolean;
}

// Roles a person can hold. The list mixes staff, drivers and administrators, so
// narrowing by role is usually the first thing you want before searching by name.
const FILTERABLE_ROLES = ["ADMIN", "REQUESTER", "DRIVER"] as const;

export function UsersListClient({ users }: { users: AdminUserListRow[] }) {
  const t = useTranslations("listSearch");
  const tr = useTranslations("roles");
  const [roles, setRoles] = useState<string[]>([]);

  const toggleRole = (r: string) =>
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  // An account can hold more than one role, so a filtered account is one that
  // holds ANY of the selected roles.
  const visible = useMemo(
    () => (roles.length === 0 ? users : users.filter((u) => u.roles.some((r) => roles.includes(r)))),
    [users, roles],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERABLE_ROLES.map((r) => {
          const active = roles.includes(r);
          return (
            <button
              key={r}
              type="button"
              onClick={() => toggleRole(r)}
              aria-pressed={active}
              className={`inline-flex h-9 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {tr(r)}
            </button>
          );
        })}
        {roles.length > 0 && (
          <button
            type="button"
            onClick={() => setRoles([])}
            className="inline-flex h-9 items-center rounded-md px-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {t("clearRoles")}
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {t("countShown", { shown: visible.length, total: users.length })}
        </span>
      </div>

      <ListSearch
        items={visible}
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
    </div>
  );
}
