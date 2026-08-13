"use client";

import { useEffect, useState } from "react";
import { StarRating } from "@/components/StarRating";
import { useI18n } from "@/components/LanguageProvider";

// Rate the video itself 0–5 stars after dubbing it. `raterKey` identifies who's
// rating (a room player id in a party, or the browser client id in solo) so a
// re-rate updates the same row. Restores any prior score on mount. `onSaved`
// reports whether the current score is persisted, so a caller can gate on it.
export function RateVideo({
  uploadId,
  raterKey,
  onSaved,
}: {
  uploadId: string;
  raterKey: string;
  onSaved?: (done: boolean) => void;
}) {
  const { t } = useI18n();
  const [stars, setStars] = useState(0);
  const [rated, setRated] = useState(false); // has a stored score (this rater)
  const [saved, setSaved] = useState(false); // current selection is persisted
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Let a parent gate on whether the current score is persisted.
  useEffect(() => {
    onSaved?.(saved);
  }, [saved, onSaved]);

  useEffect(() => {
    if (!uploadId || !raterKey) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/video/rate?uploadId=${encodeURIComponent(uploadId)}&raterKey=${encodeURIComponent(raterKey)}`,
        );
        if (!r.ok) return;
        const d = (await r.json()) as { stars: number | null };
        if (cancelled || d.stars == null) return;
        setStars(d.stars);
        setRated(true);
        setSaved(true);
      } catch {
        /* best-effort restore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uploadId, raterKey]);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/video/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId, raterKey, stars }),
      });
      if (!r.ok) throw new Error((await r.json()).error || t("cmp.rateVideo.cantSave"));
      setRated(true);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("cmp.rateVideo.cantSave"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 border-t border-cream/10 pt-5">
      <h3 className="mb-1 text-center font-display text-[16px] font-black text-cream">
        {t("cmp.rateVideo.title")}
      </h3>
      <p className="mb-3 text-center text-[12px] text-cream/55">
        {saved ? t("cmp.rateVideo.thanks") : t("cmp.rateVideo.how")}
      </p>
      <div className="flex flex-col items-center gap-3">
        <StarRating
          value={stars}
          size={30}
          onChange={(v) => {
            setStars(v);
            setSaved(false);
          }}
        />
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="g-btn g-btn-primary w-full"
        >
          {busy ? t("common.saving") : rated ? t("cmp.rateVideo.update") : t("cmp.rateVideo.submit")}
        </button>
        {err && <p className="text-[13px] text-magenta">{err}</p>}
      </div>
    </div>
  );
}
