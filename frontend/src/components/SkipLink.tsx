"use client";

import { useI18n } from "@/contexts/PreferencesContext";

export function SkipLink() {
  const { t } = useI18n();
  return (
    <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:bg-paper focus:px-3 focus:py-2">
      {t("common.skipToContent")}
    </a>
  );
}
