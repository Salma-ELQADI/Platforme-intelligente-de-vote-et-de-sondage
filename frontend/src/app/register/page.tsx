"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Field, Input, TextLink } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { ApiError } from "@/lib/api";

export default function RegisterPage() {
  const { register, status } = useAuth();
  const { t, errorText, fieldError } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState({ username: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await register(form);
      router.replace("/");
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      kicker={t("auth.kicker")}
      title={t("auth.registerTitle")}
      subtitle={t("auth.registerSubtitle")}
      quote={t("auth.registerQuote")}
      footer={
        <>
          {t("auth.already")}{" "}
          <TextLink href="/login">{t("auth.login")}</TextLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <Field label={t("auth.username")} htmlFor="username" error={fieldError(error, "username")}>
          <Input id="username" autoComplete="username" value={form.username} onChange={set("username")} required minLength={3} maxLength={30} dir="ltr" />
        </Field>
        <Field label={t("auth.email")} htmlFor="email" error={fieldError(error, "email")}>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} required dir="ltr" />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("auth.password")} htmlFor="password" error={fieldError(error, "password")} hint={t("auth.passwordHint")}>
            <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required dir="ltr" />
          </Field>
          <Field label={t("auth.confirm")} htmlFor="confirm" error={fieldError(error, "confirmPassword")}>
            <Input id="confirm" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set("confirmPassword")} required dir="ltr" />
          </Field>
        </div>
        {error && !error.details && <Alert>{errorText(error)}</Alert>}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          {t("auth.submitRegister")}
        </Button>
      </form>
    </AuthShell>
  );
}
