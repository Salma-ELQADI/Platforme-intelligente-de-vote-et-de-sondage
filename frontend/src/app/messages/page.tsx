"use client";

import { Fleuron } from "@/components/decor";
import { useI18n } from "@/contexts/PreferencesContext";

/** Desktop right panel when no conversation is selected. */
export default function MessagesIndex() {
  const { t } = useI18n();
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <Fleuron size={26} outline className="mx-auto text-umber" />
        <p className="mt-5 font-serif text-2xl italic text-ink">{t("messages.selectTitle")}</p>
        <p className="mt-2 text-[15px] text-umber">{t("messages.selectText")}</p>
      </div>
    </div>
  );
}
