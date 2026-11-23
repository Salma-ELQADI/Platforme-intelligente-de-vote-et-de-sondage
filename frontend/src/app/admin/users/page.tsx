"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, PageHeader, PageLoader } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import { cn, formatShortDate } from "@/lib/format";
import type { User } from "@/types";

/** Administration: visible only to admins (and every call is re-checked by the API). */
export default function AdminUsersPage() {
  const { ready, user: me } = useRequireAuth("admin");
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((q = "") => {
    api.listUsers({ search: q || undefined }).then((d) => setUsers(d.users)).catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const update = async (u: User, body: { role?: User["role"]; isActive?: boolean }) => {
    try {
      const { user } = await api.adminUpdateUser(u.id, body);
      setUsers((list) => list?.map((x) => (x.id === user.id ? user : x)) ?? null);
      toast("Compte mis à jour.", "success");
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  };

  if (!ready) return <PageLoader />;

  return (
    <>
      <PageHeader kicker="Administration" title="Registre des comptes" subtitle="Rôles et accès des membres de la plateforme." />
      <form
        role="search"
        className="mb-8 flex"
        onSubmit={(e) => {
          e.preventDefault();
          load(search.trim());
        }}
      >
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom ou email" aria-label="Rechercher un compte" className="border-r-0 sm:w-80" />
        <Button type="submit" variant="secondary" className="h-11">Rechercher</Button>
      </form>
      {error && <Alert>{error}</Alert>}
      {!users && !error && <PageLoader />}
      {users && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-y border-ink">
              <tr>
                {["Membre", "Rôle", "Statut", "Inscription", ""].map((h) => (
                  <th key={h} className="kicker px-3 py-3 font-semibold text-umber">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-rule transition-colors hover:bg-paper/70">
                  <td className="px-3 py-4">
                    <p className="font-serif text-lg font-semibold text-ink">{u.username}</p>
                    <p className="text-xs text-umber">{u.email}</p>
                  </td>
                  <td className="px-3 py-4">
                    <span className={cn("kicker", u.role === "admin" ? "bg-ink px-2 py-1 text-paper" : "text-ink")}>{u.role === "admin" ? "Administrateur" : "Lecteur"}</span>
                  </td>
                  <td className="px-3 py-4">
                    <span className={cn("kicker", u.isActive ? "text-ink" : "text-umber line-through")}>{u.isActive ? "Actif" : "Désactivé"}</span>
                  </td>
                  <td className="px-3 py-4 font-mono text-xs text-umber">{formatShortDate(u.createdAt)}</td>
                  <td className="px-3 py-4 text-right">
                    {u.id !== me?.id ? (
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => update(u, { role: u.role === "admin" ? "user" : "admin" })}>
                          {u.role === "admin" ? "Retirer les droits" : "Nommer administrateur"}
                        </Button>
                        <Button variant={u.isActive ? "danger" : "secondary"} size="sm" onClick={() => update(u, { isActive: !u.isActive })}>
                          {u.isActive ? "Désactiver" : "Réactiver"}
                        </Button>
                      </div>
                    ) : (
                      <span className="font-serif text-sm italic text-umber">Votre compte</span>
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
