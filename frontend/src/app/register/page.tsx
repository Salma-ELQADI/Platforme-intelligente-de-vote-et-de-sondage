"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Field, Input, TextLink } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError } from "@/lib/api";

export default function RegisterPage() {
  const { register, status } = useAuth();
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
      kicker="Espace lecteurs"
      title="Créer un compte"
      subtitle="Un compte suffit pour rédiger des sondages, voter et suivre les dépouillements."
      quote="Posez la question. La communauté répond en direct."
      footer={
        <>
          Déjà inscrit ?{" "}
          <TextLink href="/login">Se connecter</TextLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="Nom d’utilisateur" htmlFor="username" error={error?.fieldError("username")}>
          <Input id="username" autoComplete="username" value={form.username} onChange={set("username")} required minLength={3} maxLength={30} />
        </Field>
        <Field label="Email" htmlFor="email" error={error?.fieldError("email")}>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} required />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Mot de passe" htmlFor="password" error={error?.fieldError("password")} hint="8 caractères, une lettre et un chiffre">
            <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required />
          </Field>
          <Field label="Confirmation" htmlFor="confirm" error={error?.fieldError("confirmPassword")}>
            <Input id="confirm" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set("confirmPassword")} required />
          </Field>
        </div>
        {error && !error.details && <Alert>{error.message}</Alert>}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Créer mon compte
        </Button>
      </form>
    </AuthShell>
  );
}
