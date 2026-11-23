"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Field, Input, TextLink } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError } from "@/lib/api";

/** Only allow internal redirects (prevents open-redirect via ?next=https://evil.com). */
export const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

export function LoginForm() {
  const { login, status } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
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
      await login(email, password);
      router.replace(next);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      kicker="Espace lecteurs"
      title="Connexion"
      subtitle="Retrouvez vos sondages, vos bulletins et les résultats que vous suivez."
      quote="Chaque voix compte, et chacune ne compte qu’une fois."
      footer={
        <>
          Pas encore de compte ?{" "}
          <TextLink href="/register">Créer un compte</TextLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="Email" htmlFor="email" error={error?.fieldError("email")}>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Mot de passe" htmlFor="password" error={error?.fieldError("password")}>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && !error.details && <Alert>{error.message}</Alert>}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Se connecter
        </Button>
      </form>
    </AuthShell>
  );
}
