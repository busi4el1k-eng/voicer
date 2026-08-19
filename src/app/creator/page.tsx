"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AccountBar } from "@/components/AccountBar";
import { useI18n } from "@/components/LanguageProvider";
import { useAppDialog } from "@/components/AppDialog";
import { VideoThumb } from "@/components/VideoThumb";
import { LiquidLogo } from "@/components/LiquidLogo";
import { formatShareId } from "@/lib/share-id";
import { LOCALES, LOCALE_META } from "@/lib/i18n";
import { Flag } from "@/components/Flag";

// One fixed colour per player seat (1-4), matching the editor.
const PLAYER_COLORS = ["#FF3D8B", "#FFD23F", "#27E1A1", "#38BDF8", "#A78BFA", "#FB923C", "#F87171"];

type Segment = {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  label: string;
  transcript: string;
  emotionTag: string;
  player?: number;
  status: string;
  partUrl?: string | null;
};
type Upload = {
  id: string;
  title: string;
  status: string;
  visibility: string; // 'private' | 'public'
  language: string | null; // content language (app locale) or null when unset
  shareId: string | null;
  sourceUrl: string;
  error: string;
  segments: Segment[];
};

// Upload + Demucs progress overlay (the liquid "dubthatmovie" bar).
type Overlay = {
  active: boolean;
  phase: "upload" | "separating" | "ready" | "error";
  progress: number; // 0..1 across the whole upload → separation flow
  message: string;
  uploadId?: string;
};

// POST the file with real upload progress (fetch can't report upload progress).
// The file is sent as the raw request body (metadata in the query string) so the
// server can stream it to storage without buffering the whole video in memory.
function uploadXhr(file: File, title: string, onProgress: (frac: number) => void): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const qs = new URLSearchParams({ filename: file.name, title });
    xhr.open("POST", `/api/creator/upload?${qs.toString()}`);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        const d = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(d.upload as Upload);
        else reject(new Error(d.error || "Upload failed."));
      } catch {
        reject(new Error("Upload failed."));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(file);
  });
}

// Poll the music-bed status while easing the visual toward ~0.96. Resolves with
// the terminal status; "none" (separation not configured) resolves after a short
// grace so the flow never hangs.
function waitForBed(
  uploadId: string,
  onTick: (p: number) => void,
): Promise<"ready" | "error" | "none"> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stopped = false;
    const ease = window.setInterval(() => {
      const el = (Date.now() - start) / 1000;
      onTick(Math.min(0.96, 0.4 + 0.56 * (1 - Math.exp(-el / 80))));
    }, 120);
    const finish = (s: "ready" | "error" | "none") => {
      stopped = true;
      window.clearInterval(ease);
      resolve(s);
    };
    const poll = async () => {
      if (stopped) return;
      try {
        const r = await fetch(`/api/creator/bed?uploadId=${uploadId}`);
        const d = (await r.json()) as { status?: string };
        if (d.status === "ready") return finish("ready");
        if (d.status === "error") return finish("error");
        if (d.status === "none" && Date.now() - start > 12000) return finish("none");
      } catch {
        /* transient — keep polling */
      }
      if (!stopped) window.setTimeout(poll, 2500);
    };
    void poll();
  });
}

export default function CreatorPage() {
  const [jobs, setJobs] = useState<Upload[]>([]);
  const [loaded, setLoaded] = useState(false); // first jobs fetch has resolved
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string>(""); // "upload" | `del:<id>` | `rename:<id>`
  const [err, setErr] = useState("");
  const [ov, setOv] = useState<Overlay>({ active: false, phase: "upload", progress: 0, message: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const { dialog, confirm, alert } = useAppDialog();
  const { t } = useI18n();

  // Inline rename state for the management table.
  const [editingId, setEditingId] = useState("");
  const [editTitle, setEditTitle] = useState("");

  // Which row's settings (rename/delete) menu is open.
  const [menuId, setMenuId] = useState("");
  // Which row's language picker popover is open (id, or "" for none).
  const [langMenuId, setLangMenuId] = useState("");
  // Id of the row whose share code was just copied (for the ✓ feedback).
  const [copiedId, setCopiedId] = useState("");

  const copyShareId = (code: string, id: string) => {
    void navigator.clipboard?.writeText(code);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((c) => (c === id ? "" : c)), 1500);
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/creator/jobs?scope=personal");
      const d = (await r.json()) as { uploads: Upload[] };
      setJobs(d.uploads ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Watch the bed separation to completion, easing the liquid fill as it goes.
  const runSeparation = useCallback(
    async (uploadId: string) => {
      const res = await waitForBed(uploadId, (p) =>
        setOv((o) => ({ ...o, progress: Math.max(o.progress, p) })),
      );
      if (res === "error") {
        setOv((o) => ({
          ...o,
          phase: "error",
          message: t("creator.bedError"),
        }));
        return;
      }
      setOv((o) => ({
        ...o,
        phase: "ready",
        progress: 1,
        message: res === "ready" ? t("creator.musicReady") : t("creator.uploaded"),
      }));
      await load();
      // Don't auto-dismiss: the video isn't playable yet — the creator must
      // open the editor to mark the sectors. Keep the overlay up with a
      // prominent "Open editor" CTA so that next step is unmissable.
    },
    [load, t],
  );

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr(t("creator.chooseFirst"));
    setErr("");
    setOv({ active: true, phase: "upload", progress: 0, message: t("creator.uploading") });
    try {
      // Upload occupies the first third of the bar; separation the rest.
      const up = await uploadXhr(file, title, (frac) =>
        setOv((o) => ({ ...o, progress: frac * 0.3, message: t("creator.uploading") })),
      );
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      setOv((o) => ({
        ...o,
        phase: "separating",
        progress: Math.max(o.progress, 0.36),
        uploadId: up.id,
        message: t("creator.separating"),
      }));
      await runSeparation(up.id);
    } catch (e) {
      setOv((o) => ({
        ...o,
        phase: "error",
        message: e instanceof Error ? e.message : t("creator.uploadFailed"),
      }));
    }
  };

  // Re-kick separation after an error (the upload itself already succeeded).
  const retryBed = async () => {
    const id = ov.uploadId;
    if (!id) {
      setOv((o) => ({ ...o, active: false }));
      return;
    }
    setOv((o) => ({ ...o, phase: "separating", progress: Math.max(o.progress, 0.4), message: t("creator.separating") }));
    try {
      await fetch("/api/creator/bed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: id }),
      });
    } catch {
      /* the poll below will surface any persistent failure */
    }
    await runSeparation(id);
  };

  const remove = async (j: Upload) => {
    const ok = await confirm({
      title: t("creator.deleteTitle"),
      message: t("creator.deleteMsg", { title: j.title || t("lib.untitled") }),
      confirmLabel: t("creator.delete"),
      tone: "danger",
      icon: "🗑️",
    });
    if (!ok) return;
    setErr("");
    setBusy(`del:${j.id}`);
    try {
      const r = await fetch(`/api/creator/upload/${j.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error || t("creator.deleteFailed"));
      await load();
    } catch (e) {
      await alert({
        title: t("creator.cantDelete"),
        message: e instanceof Error ? e.message : t("creator.deleteFailed"),
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  };

  // Flip a video between private and public. Public videos show up in the
  // shared Video library for every user to browse and dub.
  const toggleVisibility = async (j: Upload) => {
    const next = j.visibility === "public" ? "private" : "public";
    setErr("");
    setBusy(`vis:${j.id}`);
    // Optimistic — the pill flips immediately, reconciled by the reload below.
    setJobs((prev) => prev.map((u) => (u.id === j.id ? { ...u, visibility: next } : u)));
    try {
      const r = await fetch(`/api/creator/upload/${j.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!r.ok) throw new Error((await r.json()).error || t("creator.updateFailed"));
      await load();
    } catch (e) {
      await load(); // roll back the optimistic flip to the server truth
      await alert({
        title: t("creator.cantVisibility"),
        message: e instanceof Error ? e.message : t("creator.updateFailed"),
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  };

  // Set (or clear) a video's content language. Public videos are grouped by
  // this in the shared library so visitors see their own language first; empty
  // clears the tag and lets the library fall back to guessing from the title.
  const setLanguage = async (j: Upload, next: string) => {
    setErr("");
    setBusy(`lang:${j.id}`);
    // Optimistic — reconciled by the reload below.
    setJobs((prev) => prev.map((u) => (u.id === j.id ? { ...u, language: next || null } : u)));
    try {
      const r = await fetch(`/api/creator/upload/${j.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: next }),
      });
      if (!r.ok) throw new Error((await r.json()).error || t("creator.updateFailed"));
      await load();
    } catch (e) {
      await load(); // roll back to server truth
      await alert({
        title: t("creator.cantVisibility"),
        message: e instanceof Error ? e.message : t("creator.updateFailed"),
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  };

  const startRename = (j: Upload) => {
    setEditingId(j.id);
    setEditTitle(j.title);
  };

  const saveRename = async (id: string) => {
    setErr("");
    setBusy(`rename:${id}`);
    try {
      const r = await fetch(`/api/creator/upload/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle }),
      });
      if (!r.ok) throw new Error((await r.json()).error || t("creator.renameFailed"));
      setEditingId("");
      await load();
    } catch (e) {
      await alert({
        title: t("creator.cantRename"),
        message: e instanceof Error ? e.message : t("creator.renameFailed"),
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="g-screen">
      <div className="absolute right-4 top-4 z-10">
        <AccountBar />
      </div>

      <div className="flex h-[92px] items-center">
        <h1 className="g-logo">
          Video<em>Creator</em>
        </h1>
      </div>

      <div className="g-center">
        {/* LEFT — add a video + info */}
        <div className="g-left">
          <h2 className="g-title">{t("creator.addVideo")}</h2>
          <div className="g-panel flex flex-1 flex-col gap-4">
            {/* Title */}
            <label className="flex flex-col gap-1.5">
              <span className="font-display text-[12px] font-bold uppercase tracking-[0.06em] text-mint">
                {t("creator.titleLabel")}{" "}
                <span className="font-semibold text-cream/40">— {t("creator.optional")}</span>
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("creator.titlePh")}
                className="h-[46px] rounded-[10px] border-2 border-violet-lift bg-violet-deep/50 px-4 font-display text-[15px] font-bold text-cream placeholder:font-semibold placeholder:text-cream/35 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-white"
              />
            </label>

            {/* File */}
            <label className="flex flex-col gap-1.5">
              <span className="font-display text-[12px] font-bold uppercase tracking-[0.06em] text-mint">
                {t("creator.videoFile")}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                className="cursor-pointer rounded-[10px] border-2 border-violet-lift bg-violet-deep/50 p-2 font-display text-[13px] font-semibold text-cream/70 file:mr-3 file:cursor-pointer file:rounded-[8px] file:border-0 file:bg-violet-lift file:px-3 file:py-2 file:font-display file:font-bold file:uppercase file:tracking-[0.04em] file:text-cream hover:file:bg-[#9a45d6]"
              />
            </label>

            <button className="g-btn g-btn-start w-full" onClick={upload} disabled={ov.active}>
              {ov.active ? t("common.working") : t("creator.upload")}
            </button>

            <p className="rounded-[10px] border-2 border-white/10 bg-white/[0.05] px-3.5 py-3 font-display text-[12.5px] font-semibold leading-[1.5] text-cream/65">
              {t("creator.info")}
            </p>

            {err && (
              <p className="font-display text-[13px] font-bold text-magenta">{err}</p>
            )}
          </div>
        </div>

        {/* RIGHT — manage existing videos */}
        <div className="g-right">
          <h2 className="g-title">
            {t("creator.yourVideos")}{" "}
            {loaded ? (
              `(${jobs.length})`
            ) : (
              <span
                aria-label={t("creator.loadingAria")}
                className="ml-1 inline-block h-[15px] w-[15px] animate-spin rounded-full border-2 border-cream/25 border-t-mint align-[-2px]"
              />
            )}
          </h2>
          <div className="g-panel flex-1">
            {!loaded ? (
              <p className="text-center text-[13px] text-cream/50">{t("creator.loading")}</p>
            ) : jobs.length === 0 ? (
              <p className="text-center text-[13px] text-cream/50">{t("creator.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {jobs.map((j) => {
                  const editing = editingId === j.id;
                  const rowBusy =
                    busy === `del:${j.id}` ||
                    busy === `rename:${j.id}` ||
                    busy === `vis:${j.id}`;
                  const isPublic = j.visibility === "public";
                  // The video's content language if it's one we know, else "" (Auto).
                  const curLang =
                    j.language && (LOCALES as readonly string[]).includes(j.language)
                      ? (j.language as (typeof LOCALES)[number])
                      : "";
                  const langBusy = busy === `lang:${j.id}`;
                  // Distinct players assigned across this video's sectors.
                  const players = Array.from(new Set(j.segments.map((s) => s.player ?? 1))).sort(
                    (a, b) => a - b,
                  );
                  return (
                    <li
                      key={j.id}
                      className="rounded-[12px] bg-violet-deep/40 p-3 shadow-[inset_0_0_0_2px_rgba(137,82,220,0.35)]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        {/* Title + meta (players / share code) */}
                        <div className="min-w-0 flex-1">
                          {editing ? (
                            <input
                              value={editTitle}
                              autoFocus
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void saveRename(j.id);
                                if (e.key === "Escape") setEditingId("");
                              }}
                              className="w-full rounded-[8px] bg-violet-deep/60 px-3 py-2 text-[16px] text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
                            />
                          ) : (
                            <div className="truncate font-display text-[17px] font-bold text-cream">
                              {j.title || t("lib.untitled")}
                            </div>
                          )}
                          {j.error && <div className="text-[13px] text-magenta">{j.error}</div>}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-cream/70">
                            <span className="flex items-center gap-1.5">
                              <span className="font-display font-bold text-cream/85">{players.length}</span>
                              <span className="text-cream/45">
                                {players.length === 1 ? t("creator.player") : t("creator.players")}
                              </span>
                              {players.length > 0 && (
                                <span className="flex gap-1">
                                  {players.map((p) => (
                                    <span
                                      key={p}
                                      title={t("creator.playerN", { n: p })}
                                      className="h-2.5 w-2.5 rounded-full shadow-[inset_0_0_0_1.5px_rgba(31,7,51,0.4)]"
                                      style={{ background: PLAYER_COLORS[(p - 1) % PLAYER_COLORS.length] }}
                                    />
                                  ))}
                                </span>
                              )}
                            </span>
                            {j.shareId && (
                              <button
                                type="button"
                                onClick={() => copyShareId(j.shareId!, j.id)}
                                title={t("creator.copyShare")}
                                className="flex items-center gap-1.5 font-display font-bold tracking-[0.1em] text-mint transition hover:text-cream"
                              >
                                {formatShareId(j.shareId)}
                                <span aria-hidden className="text-[12px] text-cream/40">
                                  {copiedId === j.id ? "✓" : "⧉"}
                                </span>
                              </button>
                            )}
                            {/* Library visibility toggle — public videos appear
                                in the shared Video library for every user. */}
                            <button
                              type="button"
                              onClick={() => void toggleVisibility(j)}
                              disabled={rowBusy}
                              title={isPublic ? t("creator.publicTitle") : t("creator.privateTitle")}
                              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.06em] transition disabled:opacity-60 ${
                                isPublic
                                  ? "bg-mint/20 text-mint hover:bg-mint/30"
                                  : "bg-white/8 text-cream/60 hover:bg-white/15"
                              }`}
                            >
                              <span aria-hidden>{isPublic ? "🌐" : "🔒"}</span>
                              {busy === `vis:${j.id}`
                                ? "…"
                                : isPublic
                                  ? t("creator.public")
                                  : t("creator.private")}
                            </button>
                            {/* Content language — groups the video in the shared
                                library's language filter. A custom popover (not a
                                native <select>) so it matches the site's pills:
                                shows the flag + native name, "Auto" leaves it
                                unset (the library guesses from the title). */}
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setLangMenuId(langMenuId === j.id ? "" : j.id)}
                                disabled={rowBusy}
                                aria-haspopup="listbox"
                                aria-expanded={langMenuId === j.id}
                                title={t("lib.langBy")}
                                className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.06em] transition disabled:opacity-60 ${
                                  curLang
                                    ? "bg-sun/20 text-sun shadow-[inset_0_0_0_1.5px_rgba(255,210,63,0.5)] hover:bg-sun/30"
                                    : "bg-white/8 text-cream/60 hover:bg-white/15"
                                }`}
                              >
                                {langBusy ? (
                                  "…"
                                ) : curLang ? (
                                  <>
                                    <Flag locale={curLang} size={11} />
                                    {LOCALE_META[curLang].label}
                                  </>
                                ) : (
                                  <>
                                    <span aria-hidden>🗣️</span>
                                    {t("creator.langAuto")}
                                  </>
                                )}
                                <span aria-hidden className="text-[8px] opacity-70">
                                  ▼
                                </span>
                              </button>
                              {langMenuId === j.id && (
                                <>
                                  <div className="fixed inset-0 z-20" onClick={() => setLangMenuId("")} />
                                  <ul
                                    role="listbox"
                                    className="absolute left-0 top-[calc(100%+6px)] z-30 flex w-40 flex-col overflow-hidden rounded-[10px] border-2 border-violet-lift bg-violet-deep shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
                                  >
                                    {/* Auto (clear the tag) */}
                                    <li>
                                      <button
                                        type="button"
                                        role="option"
                                        aria-selected={curLang === ""}
                                        onClick={() => {
                                          setLangMenuId("");
                                          if (curLang !== "") void setLanguage(j, "");
                                        }}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left font-display text-[13px] font-semibold transition ${
                                          curLang === ""
                                            ? "bg-mint/15 text-mint"
                                            : "text-cream hover:bg-violet-lift"
                                        }`}
                                      >
                                        <span aria-hidden className="text-[13px]">🗣️</span>
                                        {t("creator.langAuto")}
                                        {curLang === "" && <span className="ml-auto text-mint">✓</span>}
                                      </button>
                                    </li>
                                    {LOCALES.map((l) => (
                                      <li key={l}>
                                        <button
                                          type="button"
                                          role="option"
                                          aria-selected={curLang === l}
                                          onClick={() => {
                                            setLangMenuId("");
                                            if (curLang !== l) void setLanguage(j, l);
                                          }}
                                          className={`flex w-full items-center gap-2 border-t border-cream/10 px-3 py-2 text-left font-display text-[13px] font-semibold transition ${
                                            curLang === l
                                              ? "bg-mint/15 text-mint"
                                              : "text-cream hover:bg-violet-lift"
                                          }`}
                                        >
                                          <Flag locale={l} size={13} />
                                          {LOCALE_META[l].label}
                                          {curLang === l && <span className="ml-auto text-mint">✓</span>}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Preview */}
                        {j.sourceUrl && (
                          <div className="flex-none">
                            <VideoThumb src={j.sourceUrl} />
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex flex-none items-center gap-2">
                          {editing ? (
                            <>
                              <button
                                onClick={() => void saveRename(j.id)}
                                disabled={rowBusy}
                                className="g-btn g-btn-primary h-10 flex-1 px-3 text-[13px] sm:flex-none"
                              >
                                {busy === `rename:${j.id}` ? t("common.saving") : t("common.save")}
                              </button>
                              <button
                                onClick={() => setEditingId("")}
                                className="g-btn g-btn-ghost h-10 flex-1 px-3 text-[13px] sm:flex-none"
                              >
                                {t("common.cancel")}
                              </button>
                            </>
                          ) : (
                            <>
                              <Link
                                href={`/creator/${j.id}`}
                                className="g-btn g-btn-start flex h-10 flex-1 items-center justify-center px-3 text-[13px] sm:flex-none"
                              >
                                {t("creator.openEditor")}
                              </Link>
                              <div className="relative flex-none">
                                <button
                                  aria-label={t("creator.settings")}
                                  title={t("creator.settings")}
                                  onClick={() => setMenuId(menuId === j.id ? "" : j.id)}
                                  disabled={rowBusy}
                                  className="g-btn g-btn-ghost flex h-10 w-10 items-center justify-center p-0 text-[16px] leading-none"
                                >
                                  <span aria-hidden>{rowBusy ? "…" : "⚙️"}</span>
                                </button>
                                {menuId === j.id && (
                                  <>
                                    <div className="fixed inset-0 z-20" onClick={() => setMenuId("")} />
                                    <div className="absolute right-0 top-[calc(100%+6px)] z-30 flex w-40 flex-col overflow-hidden rounded-[10px] border-2 border-violet-lift bg-violet-deep shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                                      <button
                                        onClick={() => {
                                          setMenuId("");
                                          startRename(j);
                                        }}
                                        className="flex items-center gap-2 px-3 py-2.5 text-left font-display text-[14px] font-semibold text-cream hover:bg-violet-lift"
                                      >
                                        <span aria-hidden>✏️</span> {t("creator.rename")}
                                      </button>
                                      <button
                                        onClick={() => {
                                          setMenuId("");
                                          void remove(j);
                                        }}
                                        className="flex items-center gap-2 border-t border-cream/10 px-3 py-2.5 text-left font-display text-[14px] font-semibold text-magenta hover:bg-magenta/15"
                                      >
                                        <span aria-hidden>🗑️</span> {t("creator.delete")}
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Upload + Demucs separation — liquid "dubthatmovie" progress overlay */}
      {ov.active && (
        <div className="g-modal-overlay" style={{ zIndex: 60 }}>
          <div className="g-modal" style={{ maxWidth: 640, gap: 14, padding: "30px 26px 24px" }}>
            <div style={{ width: "100%", padding: "0 4px" }}>
              <LiquidLogo progress={ov.progress} />
            </div>
            <div
              className="tnum"
              style={{
                fontFamily: "var(--font-nunito), sans-serif",
                fontWeight: 900,
                fontSize: 30,
                color: "#5cffb6",
                textShadow: "var(--g-outline-dark)",
              }}
            >
              {Math.round(ov.progress * 100)}%
            </div>
            <div className="g-modal-title" style={{ fontSize: 18 }}>
              {ov.message}
            </div>
            {ov.phase === "separating" && (
              <div className="g-modal-sub">{t("creator.separatingSub")}</div>
            )}
            {ov.phase === "ready" && (
              <>
                <div className="g-modal-sub">
                  <strong className="text-mint">{t("creator.nextStep")}</strong>{" "}
                  {t("creator.readySub")}
                </div>
                <div className="flex flex-col items-center gap-2 pt-1">
                  {ov.uploadId && (
                    <Link
                      href={`/creator/${ov.uploadId}`}
                      className="g-btn g-btn-start flex w-full items-center justify-center gap-2"
                      style={{ height: 52, padding: "0 24px", fontSize: 17 }}
                    >
                      <span aria-hidden>🎬</span> {t("creator.openEditor")}
                    </Link>
                  )}
                  <button
                    className="g-btn g-btn-ghost"
                    style={{ height: 40, padding: "0 18px", fontSize: 14 }}
                    onClick={() => setOv((o) => ({ ...o, active: false }))}
                  >
                    {t("creator.later")}
                  </button>
                </div>
              </>
            )}
            {ov.phase === "error" && (
              <div className="flex gap-2 pt-1">
                <button
                  className="g-btn g-btn-primary"
                  style={{ height: 44, padding: "0 20px", fontSize: 15 }}
                  onClick={() => void retryBed()}
                >
                  {t("creator.retry")}
                </button>
                <button
                  className="g-btn g-btn-ghost"
                  style={{ height: 44, padding: "0 20px", fontSize: 15 }}
                  onClick={() => {
                    setOv((o) => ({ ...o, active: false }));
                    void load();
                  }}
                >
                  {t("creator.continue")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {dialog}
    </main>
  );
}
