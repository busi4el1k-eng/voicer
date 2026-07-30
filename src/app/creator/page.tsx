"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AccountBar } from "@/components/AccountBar";
import { VideoThumb } from "@/components/VideoThumb";
import { formatShareId } from "@/lib/share-id";

// One fixed colour per player seat (1-4), matching the editor.
const PLAYER_COLORS = ["#FF3D8B", "#FFD23F", "#27E1A1", "#38BDF8"];

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
  shareId: string | null;
  sourceUrl: string;
  error: string;
  segments: Segment[];
};

export default function CreatorPage() {
  const [jobs, setJobs] = useState<Upload[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string>(""); // "upload" | `del:<id>` | `rename:<id>`
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Inline rename state for the management table.
  const [editingId, setEditingId] = useState("");
  const [editTitle, setEditTitle] = useState("");

  // Which row's settings (rename/delete) menu is open.
  const [menuId, setMenuId] = useState("");
  // Id of the row whose share code was just copied (for the ✓ feedback).
  const [copiedId, setCopiedId] = useState("");

  const copyShareId = (code: string, id: string) => {
    void navigator.clipboard?.writeText(code);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((c) => (c === id ? "" : c)), 1500);
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/creator/jobs");
      const d = (await r.json()) as { uploads: Upload[] };
      setJobs(d.uploads ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr("Choose a video file first.");
    setErr("");
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title);
      const r = await fetch("/api/creator/upload", { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).error || "Upload failed.");
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy("");
    }
  };

  const remove = async (j: Upload) => {
    if (!confirm(`Delete “${j.title || "Untitled"}” and its clips? This can't be undone.`)) return;
    setErr("");
    setBusy(`del:${j.id}`);
    try {
      const r = await fetch(`/api/creator/upload/${j.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error || "Delete failed.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed.");
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
      if (!r.ok) throw new Error((await r.json()).error || "Rename failed.");
      setEditingId("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Rename failed.");
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
          <h2 className="g-title">Add a video</h2>
          <div className="g-panel flex flex-1 flex-col gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="rounded-[10px] bg-violet-deep/60 px-4 py-3 text-[14px] text-cream placeholder:text-cream/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
            />
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="text-[13px] text-cream/70 file:mr-3 file:cursor-pointer file:rounded-[8px] file:border-0 file:bg-violet-lift file:px-3 file:py-2 file:font-display file:text-cream"
            />
            <button className="g-btn g-btn-start" onClick={upload} disabled={busy === "upload"}>
              {busy === "upload" ? "Uploading…" : "Upload"}
            </button>

            <p className="text-[12px] leading-[1.5] text-cream/60">
              Upload a video, then open the editor to mark the lines (sectors) on the timeline. The
              backend cuts the video at those spots and stores each part.
            </p>

            {err && <p className="text-[13px] text-magenta">{err}</p>}

            <Link href="/dashboard" className="mt-auto text-[13px] text-cream/50 underline">
              Back to lobby
            </Link>
          </div>
        </div>

        {/* RIGHT — manage existing videos */}
        <div className="g-right">
          <h2 className="g-title">Your videos ({jobs.length})</h2>
          <div className="g-panel flex-1">
            {jobs.length === 0 ? (
              <p className="text-center text-[13px] text-cream/50">
                Nothing uploaded yet. Add a video on the left.
              </p>
            ) : (
              <div>
                <table className="w-full table-fixed text-center text-[16px] text-cream/85">
                  <thead className="text-[13px] font-display font-bold uppercase tracking-[0.06em] text-mint">
                    <tr>
                      <th className="w-[16%] py-2 px-2">Title</th>
                      <th className="w-[14%] py-2 px-2">Players</th>
                      <th className="w-[16%] py-2 px-2">Code</th>
                      <th className="w-[16%] py-2 px-2">Preview</th>
                      <th className="w-[38%] py-2 px-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => {
                      const editing = editingId === j.id;
                      const rowBusy = busy === `del:${j.id}` || busy === `rename:${j.id}`;
                      return (
                        <tr key={j.id} className="border-t border-cream/10 align-middle">
                          <td className="py-3 px-2">
                            {editing ? (
                              <input
                                value={editTitle}
                                autoFocus
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void saveRename(j.id);
                                  if (e.key === "Escape") setEditingId("");
                                }}
                                className="w-full rounded-[8px] bg-violet-deep/60 px-2 py-1.5 text-center text-[16px] text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
                              />
                            ) : (
                              <span className="font-display text-[17px] font-bold text-cream">
                                {j.title || "Untitled"}
                              </span>
                            )}
                            {j.error && <div className="text-[13px] text-magenta">{j.error}</div>}
                          </td>
                          <td className="py-3 px-2">
                            {(() => {
                              // Distinct players assigned across this video's sectors.
                              const players = Array.from(
                                new Set(j.segments.map((s) => s.player ?? 1)),
                              ).sort((a, b) => a - b);
                              if (j.segments.length === 0)
                                return <span className="text-cream/40">—</span>;
                              return (
                                <div className="flex items-center justify-center gap-1.5">
                                  <span className="font-display text-[17px] font-bold text-cream">
                                    {players.length}
                                  </span>
                                  <span className="flex gap-1">
                                    {players.map((p) => (
                                      <span
                                        key={p}
                                        title={`Player ${p}`}
                                        className="h-3 w-3 rounded-full shadow-[inset_0_0_0_1.5px_rgba(31,7,51,0.4)]"
                                        style={{ background: PLAYER_COLORS[(p - 1) % 4] }}
                                      />
                                    ))}
                                  </span>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="py-3 px-2">
                            {j.shareId ? (
                              <button
                                type="button"
                                onClick={() => copyShareId(j.shareId!, j.id)}
                                title="Copy share code"
                                className="mx-auto flex items-center gap-1.5 font-display text-[14px] font-bold tracking-[0.12em] text-mint transition hover:text-cream"
                              >
                                {formatShareId(j.shareId)}
                                <span aria-hidden className="text-[12px] text-cream/40">
                                  {copiedId === j.id ? "✓" : "⧉"}
                                </span>
                              </button>
                            ) : (
                              <span className="text-cream/40">—</span>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex justify-center">
                              {j.sourceUrl ? (
                                <VideoThumb src={j.sourceUrl} />
                              ) : (
                                <span className="text-cream/40">—</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex flex-none items-center justify-center gap-2">
                              {editing ? (
                                <>
                                  <button
                                    onClick={() => void saveRename(j.id)}
                                    disabled={rowBusy}
                                    className="g-btn g-btn-primary h-9 px-3 text-[13px]"
                                  >
                                    {busy === `rename:${j.id}` ? "Saving…" : "Save"}
                                  </button>
                                  <button
                                    onClick={() => setEditingId("")}
                                    className="g-btn g-btn-ghost h-9 px-3 text-[13px]"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <Link
                                    href={`/creator/${j.id}`}
                                    className="g-btn g-btn-start flex h-9 items-center px-3 text-[13px]"
                                  >
                                    Open editor
                                  </Link>
                                  <div className="relative">
                                    <button
                                      aria-label="Settings"
                                      title="Settings"
                                      onClick={() => setMenuId(menuId === j.id ? "" : j.id)}
                                      disabled={rowBusy}
                                      className="g-btn g-btn-ghost flex h-9 w-9 items-center justify-center p-0 text-[16px] leading-none"
                                    >
                                      <span aria-hidden>{rowBusy ? "…" : "⚙️"}</span>
                                    </button>
                                    {menuId === j.id && (
                                      <>
                                        <div
                                          className="fixed inset-0 z-20"
                                          onClick={() => setMenuId("")}
                                        />
                                        <div className="absolute right-0 top-[calc(100%+6px)] z-30 flex w-40 flex-col overflow-hidden rounded-[10px] border-2 border-violet-lift bg-violet-deep shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                                        <button
                                          onClick={() => {
                                            setMenuId("");
                                            startRename(j);
                                          }}
                                          className="flex items-center gap-2 px-3 py-2.5 text-left font-display text-[14px] font-semibold text-cream hover:bg-violet-lift"
                                        >
                                          <span aria-hidden>✏️</span> Rename
                                        </button>
                                        <button
                                          onClick={() => {
                                            setMenuId("");
                                            void remove(j);
                                          }}
                                          className="flex items-center gap-2 border-t border-cream/10 px-3 py-2.5 text-left font-display text-[14px] font-semibold text-magenta hover:bg-magenta/15"
                                        >
                                          <span aria-hidden>🗑️</span> Delete
                                        </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
