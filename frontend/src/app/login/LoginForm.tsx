"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Field, Input, TextLink } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { ApiError } from "@/lib/api";

/** Only allow internal redirects (prevents open-redirect via ?next=https://evil.com). */
export const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

export function LoginForm() {
  const { login, status } = useAuth();
  const { t, errorText, fieldError } = useI18n();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
      router.replace(next);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      kicker={t("auth.kicker")}
      title={t("auth.loginTitle")}
      subtitle={t("auth.loginSubtitle")}
      quote={t("auth.loginQuote")}
      footer={
        <>
          {t("auth.noAccount")}{" "}
          <TextLink href="/register">{t("auth.createAccount")}</TextLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <Field label={t("auth.identifier")} htmlFor="identifier" error={fieldError(error, "identifier")}>
          <Input id="identifier" autoComplete="username" autoCapitalize="none" spellCheck={false} value={identifier} onChange={(e) => setIdentifier(e.target.value)} required dir="ltr" />
        </Field>
        <Field label={t("auth.password")} htmlFor="password" error={fieldError(error, "password")}>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required dir="ltr" />
        </Field>
        {error && !error.details && <Alert>{errorText(error)}</Alert>}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          {t("auth.login")}
        </Button>
      </form>
    </AuthShell>
  );
}
