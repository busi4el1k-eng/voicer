"use client";

import Link from "next/link";
import { useI18n } from "@/components/LanguageProvider";

// The action under a shared dub on the public /watch page: just a button to the
// dashboard. Split out as a client component so the label stays translated
// (useI18n) while the page itself is a server component that reads the share.
export function WatchActions() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3">
      <Link href="/dashboard" className="g-btn g-btn-start w-full">
        {t("watch.goToDashboard")}
      </Link>
    </div>
  );
}
