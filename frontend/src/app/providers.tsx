"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { MessagingProvider } from "@/contexts/MessagingContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { SocketProvider } from "@/contexts/SocketContext";
import { ToastProvider } from "@/contexts/ToastContext";
import type { Locale, ThemePreference } from "@/types";

export function Providers({ initialLocale, initialTheme, children }: { initialLocale: Locale; initialTheme: ThemePreference; children: ReactNode }) {
  return (
    <PreferencesProvider initialLocale={initialLocale} initialTheme={initialTheme}>
      <ToastProvider>
        <AuthProvider>
          <SocketProvider>
            <MessagingProvider>{children}</MessagingProvider>
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </PreferencesProvider>
  );
}
