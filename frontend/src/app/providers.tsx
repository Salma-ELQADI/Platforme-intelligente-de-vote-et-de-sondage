"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { SocketProvider } from "@/contexts/SocketContext";
import { ToastProvider } from "@/contexts/ToastContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <SocketProvider>{children}</SocketProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
