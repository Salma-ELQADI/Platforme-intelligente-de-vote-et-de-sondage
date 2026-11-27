"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/format";
import { Button } from "../ui";

const MAX = 2000;

/**
 * Message composer. Enter sends, Shift+Enter starts a new line (IME
 * composition, e.g. for Arabic input methods, is never interrupted).
 * The text direction follows what is typed (dir="auto").
 */
export function Composer({ onSend, onTyping, disabled }: { onSend: (body: string) => void; onTyping: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const left = MAX - value.length;

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  const submit = () => {
    if (!value.trim() || left < 0) return;
    onSend(value);
    setValue("");
    requestAnimationFrame(resize);
    ref.current?.focus();
  };

  return (
    <form
      className="border-t border-ink bg-paper px-3 py-3 sm:px-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2">
        <label htmlFor="composer" className="sr-only">{t("messages.composerLabel")}</label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          dir="auto"
          value={value}
          disabled={disabled}
          maxLength={MAX + 200}
          placeholder={t("messages.composerPlaceholder")}
          aria-describedby="composer-hint"
          onChange={(e) => {
            setValue(e.target.value);
            resize();
            if (e.target.value) onTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="block max-h-44 min-h-11 flex-1 resize-none border border-rule bg-cream/40 px-3 py-2.5 text-[15px] leading-snug text-ink placeholder:text-umber/70 focus:border-ink focus:outline-none disabled:opacity-50"
        />
        <Button type="submit" disabled={disabled || !value.trim() || left < 0} className="h-11 shrink-0" aria-label={t("messages.send")}>
          <span className="hidden sm:inline">{t("messages.send")}</span>
          <svg className="h-4 w-4 rtl:-scale-x-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinejoin="round" d="M4 12h14M12 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-[11px] text-umber">
        <span id="composer-hint" className="hidden sm:inline">{t("messages.sendShortcut")}</span>
        {left < 200 && <span className={cn("font-mono", left < 0 && "text-ink font-semibold")}>{t("messages.charactersLeft", { count: left })}</span>}
      </div>
    </form>
  );
}
