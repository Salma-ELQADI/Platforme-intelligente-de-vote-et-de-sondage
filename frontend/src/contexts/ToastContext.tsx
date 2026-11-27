"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useI18n } from "./PreferencesContext";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => undefined);

let nextId = 1;

/** Small notification banners in the bottom end corner (bottom-left in Arabic), auto-dismissed after 5 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 start-4 end-4 z-50 flex flex-col gap-2 sm:start-auto sm:w-96" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} role="status" className="animate-toast-in border border-ink bg-elevated px-4 py-3 text-sm text-ink shadow-[4px_4px_0_var(--foreground)] rtl:shadow-[-4px_4px_0_var(--foreground)]">
            <span className="kicker me-2 text-umber">{t(`toast.${toast.kind}`)}</span>
            <span className="bidi-auto">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
