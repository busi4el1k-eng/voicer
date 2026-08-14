"use client";

import { useState } from "react";
import { useI18n } from "@/components/LanguageProvider";

// Origin for the public /watch link. Prefer an explicitly configured site URL so
// production links are always https://dubthatmovie.com/… ; fall back to the
// current origin (already the real domain in the browser — localhost only in
// local dev).
function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return window.location.origin;
}

// A "Share this dub" button shown on every finish screen, meant to sit inline
// next to the Download button. On the first tap it registers the finished video
// with the backend (/api/share), gets back a short id, and copies the public
// /watch/<id> link straight to the clipboard. Later taps just re-copy it. The
// link is also shown below (on its own line) so it can be copied by hand if the
// clipboard is blocked.
export function ShareButton({
  videoUrl,
  title,
  mode,
}: {
  videoUrl: string;
  title?: string;
  mode?: "solo" | "party";
}) {
  const { t } = useI18n();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  // Build (once) or reuse the public link, then copy it to the clipboard.
  const share = async () => {
    setErr("");
    let url = link;
    if (!url) {
      setBusy(true);
      try {
        const r = await fetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoUrl, title, mode }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "");
        const d = (await r.json()) as { id: string };
        url = `${siteOrigin()}/watch/${d.id}`;
        setLink(url);
      } catch {
        setErr(t("share.failed"));
        setBusy(false);
        return;
      }
      setBusy(false);
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link stays visible below to copy by hand */
    }
  };

  return (
    <>
      <button
        className="g-btn g-btn-ghost min-w-[150px] flex-1"
        disabled={busy}
        onClick={() => void share()}
      >
        {busy ? t("share.creating") : copied ? t("common.copied") : t("share.button")}
      </button>
      {link && (
        <div className="w-full rounded-[10px] bg-violet-deep px-3 py-2 text-center">
          <p className="mb-1 text-[11px] uppercase tracking-[0.08em] text-cream/40">
            {t("share.linkReady")}
          </p>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-[13px] text-mint underline"
          >
            {link}
          </a>
        </div>
      )}
      {err && <p className="w-full text-[13px] text-magenta">{err}</p>}
    </>
  );
}
