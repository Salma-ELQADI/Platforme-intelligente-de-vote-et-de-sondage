"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { User } from "@/types";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { username: string; email: string; password: string; confirmPassword: string }) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the current user. The session itself lives in an httpOnly cookie
 * managed by the backend; on page load we simply ask GET /auth/me who we are.
 * This state is only for display: every protected action is re-checked by the API.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        setUserState(user);
        setStatus("authenticated");
      })
      .catch(() => setStatus("anonymous"));
  }, []);

  const setUser = useCallback((u: User) => {
    setUserState(u);
    setStatus("authenticated");
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { user } = await api.login({ email, password });
      setUser(user);
      return user;
    },
    [setUser],
  );

  const register = useCallback(
    async (data: { username: string; email: string; password: string; confirmPassword: string }) => {
      const { user } = await api.register(data);
      setUser(user);
      return user;
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUserState(null);
    setStatus("anonymous");
  }, []);

  return <AuthContext.Provider value={{ user, status, login, register, logout, setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
