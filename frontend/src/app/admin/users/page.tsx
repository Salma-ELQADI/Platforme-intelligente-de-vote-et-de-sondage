"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, PageHeader, PageLoader } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/format";
import type { User } from "@/types";

/** Administration: visible only to admins (and every call is re-checked by the API). */
export default function AdminUsersPage() {
  const { ready, user: me } = useRequireAuth("admin");
  const toast = useToast();
  const { t, fmt, errorText } = useI18n();
  const [users, setUsers] = useState<User[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((q = "") => {
    api.listUsers({ search: q || undefined }).then((d) => setUsers(d.users)).catch((e: ApiError) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const update = async (u: User, body: { role?: User["role"]; isActive?: boolean }) => {
    try {
      const { user } = await api.adminUpdateUser(u.id, body);
      setUsers((list) => list?.map((x) => (x.id === user.id ? user : x)) ?? null);
      toast(t("admin.updated"), "success");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  if (!ready) return <PageLoader />;

  return (
    <>
      <PageHeader kicker={t("admin.kicker")} title={t("admin.title")} subtitle={t("admin.subtitle")} />
      <form
        role="search"
        className="mb-8 flex"
        onSubmit={(e) => {
          e.preventDefault();
          load(search.trim());
        }}
      >
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.searchPlaceholder")} aria-label={t("admin.searchLabel")} dir="auto" className="border-e-0 sm:w-80" />
        <Button type="submit" variant="secondary" className="h-11">{t("common.search")}</Button>
      </form>
      {error && <Alert>{error}</Alert>}
      {!users && !error && <PageLoader />}
      {users && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-start text-sm">
            <thead className="border-y border-ink">
              <tr>
                {[t("admin.member"), t("admin.role"), t("admin.status"), t("admin.joined"), ""].map((h) => (
                  <th key={h} className="kicker px-3 py-3 text-start font-semibold text-umber">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-rule transition-colors hover:bg-paper/70">
                  <td className="px-3 py-4">
                    <p className="font-serif text-lg font-semibold text-ink"><bdi>{u.username}</bdi></p>
                    <p className="text-xs text-umber" dir="ltr">{u.email}</p>
                  </td>
                  <td className="px-3 py-4">
                    <span className={cn("kicker", u.role === "admin" ? "bg-ink px-2 py-1 text-paper" : "text-ink")}>{u.role === "admin" ? t("admin.admin") : t("admin.reader")}</span>
                  </td>
                  <td className="px-3 py-4">
                    <span className={cn("kicker", u.isActive ? "text-ink" : "text-umber line-through")}>{u.isActive ? t("admin.active") : t("admin.disabled")}</span>
                  </td>
                  <td className="px-3 py-4 font-mono text-xs text-umber">{fmt.shortDate(u.createdAt)}</td>
                  <td className="px-3 py-4 text-end">
                    {u.id !== me?.id ? (
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => update(u, { role: u.role === "admin" ? "user" : "admin" })}>
                          {u.role === "admin" ? t("admin.revoke") : t("admin.promote")}
                        </Button>
                        <Button variant={u.isActive ? "danger" : "secondary"} size="sm" onClick={() => update(u, { isActive: !u.isActive })}>
                          {u.isActive ? t("admin.disable") : t("admin.enable")}
                        </Button>
                      </div>
                    ) : (
                      <span className="font-serif text-sm italic text-umber">{t("admin.yourAccount")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
