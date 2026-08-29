"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VideoThumb } from "@/components/VideoThumb";
import { LiquidLogo } from "@/components/LiquidLogo";
import { useI18n } from "@/components/LanguageProvider";
import { formatShareId } from "@/lib/share-id";
import { LINK_PLATFORMS, type Creator, type CreatorLink } from "@/lib/creators";

// ── Upload + Demucs overlay (mirrors the creator studio's flow) ──────────────
// Same pipeline as the main upload: stream the file to storage (real progress),
// then wait for the music-bed (Demucs) separation, showing the liquid progress
// bar the whole way, and finish on an "Open editor" CTA.
type Overlay = {
  active: boolean;
  phase: "upload" | "separating" | "ready" | "error";
  progress: number; // 0..1 across upload → separation
  message: string;
  uploadId?: string;
};

// POST the file as the raw body (metadata + creatorId in the query string) with
// real upload progress. Resolves with the created upload's id.
function uploadXhr(
  file: File,
  creatorId: string,
  onProgress: (frac: number) => void,
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const qs = new URLSearchParams({ filename: file.name, title: "", creatorId });
    xhr.open("POST", `/api/creator/upload?${qs.toString()}`);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        const d = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(d.upload as { id: string });
        else reject(new Error(d.error || "Upload failed."));
      } catch {
        reject(new Error("Upload failed."));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(file);
  });
}

// Poll the music-bed status while easing the bar toward ~0.96. Resolves with the
// terminal status; "none" (separation not configured) resolves after a grace.
function waitForBed(uploadId: string, onTick: (p: number) => void): Promise<"ready" | "error" | "none"> {
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

// Admin UI for the Video library's featured creators. English-only (internal
// tool). Profile is saved via /api/admin/creators; a creator's VIDEOS are real
// uploads made through the same pipeline as the creator studio — uploaded here
// (POST /api/creator/upload?creatorId=…), then set up in the editor (/creator/:id).

type EditCreator = {
  id?: string;
  handle: string;
  name: string;
  tagline: string;
  bio: string;
  avatar: string;
  color: string;
  instagram: string;
  links: CreatorLink[];
  verified: boolean;
};

const blankCreator = (): EditCreator => ({
  handle: "",
  name: "",
  tagline: "",
  bio: "",
  avatar: "",
  color: "#f7941d",
  instagram: "",
  links: [],
  verified: false,
});

const toEdit = (c: Creator): EditCreator => ({
  id: c.id,
  handle: c.handle,
  name: c.name,
  tagline: c.tagline,
  bio: c.bio,
  avatar: c.avatar,
  color: c.color || "#f7941d",
  instagram: c.instagram,
  links: c.links ?? [],
  verified: c.verified,
});

const fieldBase =
  "rounded-[8px] bg-violet-deep/50 px-3 py-2 text-[13px] text-cream shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)] outline-none focus:shadow-[inset_0_0_0_2px_#3f8fc8]";
const field = "w-full " + fieldBase;
const label = "mb-1 block text-[11px] font-bold uppercase tracking-[0.06em] text-cream/50";

export function CreatorsAdmin() {
  const { t } = useI18n();
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<EditCreator | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Upload + Demucs progress overlay (null-ish when idle → active:false).
  const [ov, setOv] = useState<Overlay>({ active: false, phase: "upload", progress: 0, message: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/creators", { cache: "no-store" });
    const d = (await r.json().catch(() => ({}))) as { creators?: Creator[] };
    setCreators(d.creators ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The videos of the creator currently being edited (from the admin list).
  const current = editing?.id ? creators.find((c) => c.id === editing.id) : undefined;
  const videos = current?.works ?? [];

  const patch = (p: Partial<EditCreator>) => setEditing((e) => (e ? { ...e, ...p } : e));
  const addLink = () => setEditing((e) => (e ? { ...e, links: [...e.links, { platform: "youtube", url: "" }] } : e));
  const patchLink = (i: number, p: Partial<CreatorLink>) =>
    setEditing((e) => (e ? { ...e, links: e.links.map((l, j) => (j === i ? { ...l, ...p } : l)) } : e));
  const removeLink = (i: number) =>
    setEditing((e) => (e ? { ...e, links: e.links.filter((_, j) => j !== i) } : e));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const isNew = !editing.id;
      const res = await fetch(
        isNew ? "/api/admin/creators" : `/api/admin/creators/${editing.id}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editing),
        },
      );
      const d = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        setError(d.error || "Save failed.");
        return;
      }
      await load();
      // Keep the editor open on the saved creator so videos can be added next.
      if (isNew && d.id) setEditing((e) => (e ? { ...e, id: d.id } : e));
    } finally {
      setSaving(false);
    }
  };

  const del = async (c: Creator) => {
    if (!confirm(`Delete “${c.name || c.handle}”? Its videos will be unlinked.`)) return;
    await fetch(`/api/admin/creators/${c.id}`, { method: "DELETE" });
    await load();
  };

  // Watch the Demucs bed separation to completion, easing the liquid fill.
  const runSeparation = useCallback(
    async (uploadId: string) => {
      const res = await waitForBed(uploadId, (p) => setOv((o) => ({ ...o, progress: Math.max(o.progress, p) })));
      if (res === "error") {
        setOv((o) => ({ ...o, phase: "error", message: t("creator.bedError"), uploadId }));
        return;
      }
      setOv((o) => ({
        ...o,
        phase: "ready",
        progress: 1,
        uploadId,
        message: res === "ready" ? t("creator.musicReady") : t("creator.uploaded"),
      }));
      await load();
    },
    [load, t],
  );

  // Upload a video FILE onto the current creator — same flow as the studio:
  // stream to storage (first ~third of the bar), then wait for the Demucs bed.
  const uploadVideo = async (file: File) => {
    if (!editing?.id) return;
    setError("");
    setOv({ active: true, phase: "upload", progress: 0, message: t("creator.uploading") });
    try {
      const up = await uploadXhr(file, editing.id, (frac) =>
        setOv((o) => ({ ...o, progress: frac * 0.3, message: t("creator.uploading") })),
      );
      setOv((o) => ({
        ...o,
        phase: "separating",
        progress: Math.max(o.progress, 0.36),
        uploadId: up.id,
        message: t("creator.separating"),
      }));
      await runSeparation(up.id);
    } catch (e) {
      setOv((o) => ({ ...o, phase: "error", message: e instanceof Error ? e.message : t("creator.uploadFailed") }));
    }
  };

  // Re-kick separation after an error (the upload itself already succeeded).
  const retryBed = async () => {
    const id = ov.uploadId;
    if (!id) return setOv((o) => ({ ...o, active: false }));
    setOv((o) => ({ ...o, phase: "separating", progress: Math.max(o.progress, 0.4), message: t("creator.separating") }));
    try {
      await fetch("/api/creator/bed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: id }),
      });
    } catch {
      /* ignore — poll will report */
    }
    await runSeparation(id);
  };

  const delVideo = async (id: string) => {
    if (!confirm("Delete this video?")) return;
    await fetch(`/api/creator/upload/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <main className="g-screen">
      <div className="flex h-[92px] items-center">
        <h1 className="g-logo">
          Creators<em>Admin</em>
        </h1>
      </div>

      <div className="w-full max-w-[760px]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link href="/library?tab=creators" className="text-[13px] text-cream/50 underline">
            ← Back to library
          </Link>
          {!editing && (
            <button onClick={() => setEditing(blankCreator())} className="g-btn g-btn-primary h-10 px-4 text-[13px]">
              + Add creator
            </button>
          )}
        </div>

        {editing ? (
          <section className="g-panel">
            <h2 className="mb-3 font-display text-[18px] font-black text-cream">
              {editing.id ? "Edit creator" : "New creator"}
            </h2>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <span className={label}>Handle (url-safe)</span>
                <input className={field} placeholder="rayenidk" value={editing.handle} onChange={(e) => patch({ handle: e.target.value })} />
              </div>
              <div>
                <span className={label}>Display name</span>
                <input className={field} value={editing.name} onChange={(e) => patch({ name: e.target.value })} />
              </div>
              <div>
                <span className={label}>Tagline</span>
                <input className={field} value={editing.tagline} onChange={(e) => patch({ tagline: e.target.value })} />
              </div>
              <div>
                <span className={label}>Instagram URL</span>
                <input className={field} placeholder="https://www.instagram.com/…/" value={editing.instagram} onChange={(e) => patch({ instagram: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <span className={label}>Bio</span>
                <textarea className={field + " min-h-[64px] resize-y"} value={editing.bio} onChange={(e) => patch({ bio: e.target.value })} />
              </div>

              {/* Extra links / socials (YouTube, TikTok, website, …) */}
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className={label + " mb-0"}>Other links</span>
                  <button type="button" onClick={addLink} className="rounded-full bg-mint/20 px-3 py-1 text-[12px] font-bold text-mint shadow-[inset_0_0_0_2px_#4fb8e6]">
                    + Add link
                  </button>
                </div>
                {editing.links.length === 0 ? (
                  <p className="text-[12px] text-cream/40">Add YouTube, TikTok, X, a website, etc. — beyond Instagram above.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {editing.links.map((l, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={l.platform}
                          onChange={(e) => patchLink(i, { platform: e.target.value })}
                          className={fieldBase + " w-[140px] flex-none cursor-pointer"}
                        >
                          {LINK_PLATFORMS.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.icon} {p.label}
                            </option>
                          ))}
                        </select>
                        <input className={fieldBase + " min-w-0 flex-1"} placeholder="https://…" value={l.url} onChange={(e) => patchLink(i, { url: e.target.value })} />
                        <button type="button" onClick={() => removeLink(i)} title="Remove" className="grid h-8 w-8 flex-none place-items-center rounded-full bg-black/30 text-cream/70 hover:text-cream">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <span className={label}>Avatar image URL</span>
                <div className="flex items-center gap-2">
                  <input className={field} placeholder="/creators/…/avatar.jpg or https://…" value={editing.avatar} onChange={(e) => patch({ avatar: e.target.value })} />
                  {editing.avatar && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={editing.avatar} alt="" className="h-10 w-10 flex-none rounded-full object-cover" />
                  )}
                </div>
              </div>
              <div className="flex items-end gap-4">
                <div>
                  <span className={label}>Accent</span>
                  <input type="color" className="h-10 w-14 cursor-pointer rounded-[8px] bg-transparent" value={editing.color} onChange={(e) => patch({ color: e.target.value })} />
                </div>
                <label className="mb-2 flex cursor-pointer items-center gap-2 text-[13px] font-bold text-cream/85">
                  <input type="checkbox" checked={editing.verified} onChange={(e) => patch({ verified: e.target.checked })} />
                  Verified ✓
                </label>
              </div>
            </div>

            {error && <p className="mt-3 text-[13px] font-bold text-red-400">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={save} disabled={saving} className="g-btn g-btn-start h-10 px-5 text-[13px] disabled:opacity-50">
                {saving ? "Saving…" : "Save profile"}
              </button>
              <button onClick={() => setEditing(null)} className="g-btn g-btn-ghost h-10 px-5 text-[13px]">
                Done
              </button>
            </div>

            {/* Videos — only once the creator exists (needs an id to attach to). */}
            <div className="mt-6 border-t border-violet-lift/30 pt-5">
              <h3 className="mb-2 font-display text-[15px] font-black text-cream">Videos</h3>
              {!editing.id ? (
                <p className="text-[13px] text-cream/50">Save the profile first, then upload videos here.</p>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadVideo(f); e.target.value = ""; }} />
                    <button onClick={() => fileRef.current?.click()} disabled={ov.active} className="g-btn g-btn-primary h-10 px-4 text-[13px] disabled:opacity-50">
                      + Upload video
                    </button>
                    <span className="text-[12px] text-cream/45">Upload → separate music → then “Open editor” to mark sectors.</span>
                  </div>

                  {videos.length === 0 ? (
                    <p className="text-[13px] text-cream/40">No videos yet. Upload one above.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {videos.map((v) => (
                        <li key={v.id} className="flex items-center gap-3 rounded-[10px] bg-violet-deep/40 p-2.5 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.3)]">
                          {v.sourceUrl && <VideoThumb src={v.sourceUrl} />}
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-display text-[14px] font-bold text-cream">{v.title || "Untitled"}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-cream/55">
                              <span className={v.lines > 0 ? "text-mint" : "text-sun"}>
                                {v.lines > 0 ? `${v.lines} sector${v.lines === 1 ? "" : "s"}` : "no sectors — needs setup"}
                              </span>
                              {v.shareId && <span className="font-display font-bold tracking-[0.1em] text-mint">{formatShareId(v.shareId)}</span>}
                            </div>
                          </div>
                          <Link href={`/creator/${v.id}`} className="rounded-full bg-sun/20 px-3 py-1.5 text-[12px] font-bold text-sun shadow-[inset_0_0_0_2px_#FFD23F]">
                            Open editor
                          </Link>
                          <button onClick={() => delVideo(v.id)} className="rounded-full bg-black/30 px-3 py-1.5 text-[12px] font-bold text-cream/70 hover:text-cream">
                            Delete
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </section>
        ) : !loaded ? (
          <p className="text-center text-[13px] text-cream/50">Loading…</p>
        ) : creators.length === 0 ? (
          <p className="text-center text-[13px] text-cream/50">No creators yet. Add one to get started.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {creators.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-[12px] bg-violet-deep/40 p-3 shadow-[inset_0_0_0_2px_rgba(63,143,200,0.35)]">
                {c.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.avatar} alt="" className="h-12 w-12 flex-none rounded-full object-cover" />
                ) : (
                  <div className="grid h-12 w-12 flex-none place-items-center rounded-full font-display text-[18px] font-black text-white" style={{ background: c.color }}>
                    {(c.name || c.handle).charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-display text-[15px] font-black text-cream">{c.name || c.handle}</span>
                    {c.verified && <span className="text-[12px] text-mint">✓</span>}
                  </div>
                  <div className="text-[12px] text-cream/50">
                    @{c.handle} · {c.works.length} video{c.works.length === 1 ? "" : "s"}
                  </div>
                </div>
                <button onClick={() => setEditing(toEdit(c))} className="rounded-full bg-sun/20 px-3 py-1.5 text-[12px] font-bold text-sun shadow-[inset_0_0_0_2px_#FFD23F]">
                  Edit
                </button>
                <button onClick={() => del(c)} className="rounded-full bg-black/30 px-3 py-1.5 text-[12px] font-bold text-cream/70 hover:text-cream">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Upload + Demucs overlay — same liquid progress screen as the studio. */}
      {ov.active && (
        <div className="g-modal-overlay" style={{ zIndex: 60 }}>
          <div className="g-modal" style={{ maxWidth: 640, gap: 14, padding: "30px 26px 24px" }}>
            <div style={{ width: "100%", padding: "0 4px" }}>
              <LiquidLogo progress={ov.progress} />
            </div>
            <div
              className="tnum"
              style={{ fontFamily: "var(--font-nunito), sans-serif", fontWeight: 900, fontSize: 30, color: "#4fb8e6", textShadow: "var(--g-outline-dark)" }}
            >
              {Math.round(ov.progress * 100)}%
            </div>
            <div className="g-modal-title" style={{ fontSize: 18 }}>
              {ov.message}
            </div>
            {ov.phase === "separating" && <div className="g-modal-sub">{t("creator.separatingSub")}</div>}
            {ov.phase === "ready" && (
              <>
                <div className="g-modal-sub">
                  <strong className="text-mint">{t("creator.nextStep")}</strong> {t("creator.readySub")}
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
                <button className="g-btn g-btn-primary" style={{ height: 44, padding: "0 20px", fontSize: 15 }} onClick={() => void retryBed()}>
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
    </main>
  );
}
