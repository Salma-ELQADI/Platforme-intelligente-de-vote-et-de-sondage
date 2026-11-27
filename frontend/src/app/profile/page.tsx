"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, PageLoader, SectionTitle } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import Link from "next/link";
import { useI18n } from "@/contexts/PreferencesContext";

export default function ProfilePage() {
  const { ready, user } = useRequireAuth();
  const { setUser } = useAuth();
  const { t, fmt, errorText, fieldError } = useI18n();
  const toast = useToast();
  const [username, setUsername] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  if (!ready || !user) return <PageLoader />;

  const usernameValue = username ?? user.username;
  const emailValue = email ?? user.email;
  const needsPassword = emailValue !== user.email || newPassword.length > 0;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body = {
        username: usernameValue !== user.username ? usernameValue : undefined,
        email: emailValue !== user.email ? emailValue : undefined,
        newPassword: newPassword || undefined,
        currentPassword: needsPassword ? currentPassword : undefined,
      };
      const { user: updated } = await api.updateProfile(body);
      setUser(updated);
      setUsername(null);
      setEmail(null);
      setNewPassword("");
      setCurrentPassword("");
      toast(t("profile.updated"), "success");
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader kicker={t("profile.kicker")} title={t("profile.title")} action={<Link href="/settings" className="kicker text-umber underline decoration-rule underline-offset-4 hover:text-ink">{t("profile.settingsLink")}</Link>} />
      <div className="grid gap-12 lg:grid-cols-12">
        {/* Press card */}
        <aside className="lg:col-span-4">
          <div className="border border-ink bg-paper p-1.5">
            <div className="border border-rule p-6 text-center">
              <p className="kicker text-umber">{t("profile.card")}</p>
              <p className="mt-5 font-serif text-6xl font-black leading-none text-ink">{user.username[0]?.toUpperCase()}</p>
              <p className="mt-4 font-serif text-2xl font-bold text-ink"><bdi>{user.username}</bdi></p>
              <p className="mt-1 text-sm text-umber" dir="ltr">{user.email}</p>
              <dl className="mt-6 grid grid-cols-2 border-t border-rule pt-4 text-start">
                <div>
                  <dt className="kicker text-umber">{t("profile.status")}</dt>
                  <dd className="mt-1 text-sm font-medium text-ink">{user.role === "admin" ? t("profile.admin") : t("profile.reader")}</dd>
                </div>
                <div>
                  <dt className="kicker text-umber">{t("profile.since")}</dt>
                  <dd className="mt-1 font-mono text-sm text-ink">{fmt.shortDate(user.createdAt)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </aside>

        <section className="lg:col-span-7 lg:col-start-6">
          <SectionTitle>{t("profile.editInfo")}</SectionTitle>
          <Card>
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <Field label={t("profile.username")} htmlFor="username" error={fieldError(error, "username")}>
                  <Input id="username" value={usernameValue} onChange={(e) => setUsername(e.target.value)} dir="ltr" />
                </Field>
                <Field label={t("profile.email")} htmlFor="email" error={fieldError(error, "email")}>
                  <Input id="email" type="email" value={emailValue} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
                </Field>
              </div>
              <Field label={t("profile.newPassword")} htmlFor="newPassword" error={fieldError(error, "newPassword")}>
                <Input id="newPassword" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </Field>
              {needsPassword && (
                <Field label={t("profile.currentPassword")} htmlFor="currentPassword" hint={t("profile.currentPasswordHint")} error={fieldError(error, "currentPassword")}>
                  <Input id="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                </Field>
              )}
              {error && !error.details && <Alert>{errorText(error)}</Alert>}
              <Button type="submit" loading={loading}>{t("profile.save")}</Button>
            </form>
          </Card>
        </section>
      </div>
    </>
  );
}
