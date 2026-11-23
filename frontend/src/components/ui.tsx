"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/format";
import type { PollStatus } from "@/types";
import { DoubleRule, Fleuron, PressLoader } from "./decor";

/* ------------------------------------------------------------------ */
/* Buttons — set like small caps on a printed form                     */
/* ------------------------------------------------------------------ */

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper border border-ink hover:bg-umber hover:border-umber",
  secondary: "bg-transparent text-ink border border-ink hover:bg-ink hover:text-paper",
  danger: "bg-transparent text-umber border border-umber/60 hover:bg-umber hover:text-paper",
  ghost: "text-ink border border-transparent hover:border-rule",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[11px]",
  md: "h-10 px-5 text-xs",
  lg: "h-12 px-7 text-[13px]",
};

const buttonBase =
  "inline-flex items-center justify-center gap-2 font-sans font-semibold uppercase tracking-[.12em] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap";

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button {...props} disabled={disabled || loading} className={cn(buttonBase, variants[variant], sizes[size], className)}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = "primary", size = "md", className, children }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(buttonBase, variants[variant], sizes[size], className)}>
      {children}
    </Link>
  );
}

/** Inline editorial link: underlined, ink. */
export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("text-ink underline decoration-rule decoration-1 underline-offset-4 transition-colors hover:decoration-ink", className)}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="kicker block text-umber">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-umber">{hint}</p>}
      {error && <p className="font-serif text-[13px] italic text-ink">{error}</p>}
    </div>
  );
}

const control =
  "block w-full border border-rule bg-paper px-3 text-[15px] text-ink placeholder:text-umber/60 transition-colors hover:border-umber focus:border-ink focus:outline-none";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, "h-11", className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(control, "min-h-24 py-2.5 leading-relaxed", className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(control, "h-11 cursor-pointer", className)}>
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/** A sheet of paper laid on the page: thin border, square corners, no shadow. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("border border-rule bg-paper p-5 sm:p-7", className)}>{children}</div>;
}

/** Section heading: small caps label followed by a hairline running to the margin. */
export function SectionTitle({ children, aside, number }: { children: ReactNode; aside?: ReactNode; number?: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      {number && <span className="font-mono text-xs text-umber">{number}</span>}
      <h2 className="kicker shrink-0 text-ink">{children}</h2>
      <span className="h-px flex-1 bg-ink/70" aria-hidden="true" />
      {aside}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent", className)} aria-hidden="true" />;
}

export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="flex justify-center py-28">
      <PressLoader label={label} />
    </div>
  );
}

const alertLabel = { error: "Erratum", info: "Note", success: "Confirmé", warning: "Avis" } as const;

export function Alert({ kind = "error", children }: { kind?: "error" | "info" | "success" | "warning"; children: ReactNode }) {
  return (
    <div role="alert" className={cn("border-l-[3px] bg-paper px-4 py-3 text-sm leading-relaxed text-ink", kind === "error" ? "border-ink" : "border-umber")}>
      <span className="kicker mr-2 text-umber">{alertLabel[kind]}</span>
      {children}
    </div>
  );
}

const statusStyle: Record<PollStatus, { label: string; className: string }> = {
  DRAFT: { label: "Brouillon", className: "border border-dashed border-umber/60 text-umber" },
  ACTIVE: { label: "Scrutin ouvert", className: "bg-ink text-paper" },
  CLOSED: { label: "Scrutin clos", className: "border border-ink text-ink" },
};

export function StatusBadge({ status, isOpen }: { status: PollStatus; isOpen?: boolean }) {
  // An ACTIVE poll whose end time just passed (closer job not run yet) is displayed as closed.
  const effective = status === "ACTIVE" && isOpen === false ? "CLOSED" : status;
  const s = statusStyle[effective];
  return <span className={cn("kicker inline-flex h-6 items-center px-2", s.className)}>{s.label}</span>;
}

/** Category / metadata label. */
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("kicker inline-flex items-center text-umber", className)}>{children}</span>;
}

export function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <span className={cn("kicker inline-flex items-center gap-2", connected ? "text-ink" : "text-umber")}>
      <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "animate-blink bg-ink" : "bg-muted")} />
      {connected ? "En direct" : "Hors ligne"}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="border-y border-rule px-6 py-16 text-center">
      <Fleuron size={26} outline className="mx-auto text-umber" />
      <p className="mt-5 font-serif text-2xl italic text-ink">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-md text-[15px] text-umber">{description}</p>}
      {action && <div className="mt-7">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page structure                                                      */
/* ------------------------------------------------------------------ */

/** Section front: double rule, kicker, large serif headline and an italic standfirst. */
export function PageHeader({ kicker, title, subtitle, action }: { kicker?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-10">
      <DoubleRule />
      <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          {kicker && <p className="kicker text-umber">{kicker}</p>}
          <h1 className="mt-2 font-serif text-4xl font-bold leading-[1.05] text-ink sm:text-5xl">{title}</h1>
          {subtitle && <p className="mt-3 font-serif text-lg italic leading-snug text-umber">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-6 h-px bg-rule" />
    </header>
  );
}

/** Text tabs separated by vertical hairlines, like a newspaper's section index. */
export function Tabs<T extends string | undefined>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap items-center">
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <span key={item.label} className="flex items-center">
            {i > 0 && <span className="mx-4 h-4 w-px bg-rule" aria-hidden="true" />}
            <button
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.value)}
              className={cn(
                "kicker border-b-2 py-2 transition-colors",
                active ? "border-ink text-ink" : "border-transparent text-umber hover:text-ink",
              )}
            >
              {item.label}
            </button>
          </span>
        );
      })}
    </div>
  );
}
