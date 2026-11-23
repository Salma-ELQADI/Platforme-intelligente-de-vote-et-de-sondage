"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => undefined);

let nextId = 1;

/** Small notification banners in the bottom-right corner, auto-dismissed after 5 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="animate-toast-in border border-ink bg-paper px-4 py-3 text-sm text-ink shadow-[4px_4px_0_#38291f]">
            <span className="kicker mr-2 text-umber">{t.kind === "error" ? "Erratum" : t.kind === "success" ? "Confirmé" : "Dépêche"}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
