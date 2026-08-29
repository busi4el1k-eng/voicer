import type { CSSProperties } from "react";
import { ClipThumb } from "@/components/ClipThumb";
import { getTopClipsToday, type PodiumClip } from "@/lib/perf-clip";

// ── "Clips of Today" podium ────────────────────────────────────────────────
// Top 3 dubbed performances of the day (public library videos only), shown as a
// full-width window under the dashboard's mode + room windows.
//
// "Best" is a pure-DSP performance score (no AI) computed from each dub's
// recorded voice and ranked relative to the day's field — see lib/perf-clip.ts.
// Each place is just the dub's video icon (like the library): small by default,
// it enlarges into a muted preview on hover (mouse) or tap (touch), and links to
// its /watch clip. Podium height/colour carries the ranking; no labels.

// Pillar height + accent per place — 1st tallest, classic gold/silver/bronze.
const PILLAR: Record<1 | 2 | 3, { h: number; accent: string }> = {
  1: { h: 150, accent: "#FFD23F" },
  2: { h: 112, accent: "#C9D2E3" },
  3: { h: 84, accent: "#E0975A" },
};

function Step({ rank, clip }: { rank: 1 | 2 | 3; clip?: PodiumClip }) {
  const p = PILLAR[rank];
  return (
    <div className="flex w-full flex-col items-center justify-end">
      {/* The dub's video icon — enlarges on hover, click / hold opens the full
          player. Empty place → a "SOON" tile so the podium still reads as three
          steps and invites dubs. */}
      <div className="mb-1.5">
        {clip ? (
          <ClipThumb src={clip.videoUrl} />
        ) : (
          <div className="grid h-[90px] w-[150px] place-items-center rounded-[10px] border-2 border-dashed border-violet-lift/70 bg-black/25 font-display text-[11px] font-black uppercase tracking-[0.12em] text-cream/45">
            Soon
          </div>
        )}
      </div>
      {/* Author(s) of the dub, under the video. */}
      <span className="mb-2 max-w-[150px] truncate text-center font-display text-[13px] font-bold text-cream/75">
        {clip ? clip.author || "Guest" : " "}
      </span>
      {/* Pillar with its place number for style. */}
      <div
        className="flex w-full items-start justify-center rounded-t-[10px] pt-2 font-display text-[30px] font-black leading-none text-ink/55"
        style={{ height: p.h, backgroundColor: p.accent }}
      >
        {rank}
      </div>
    </div>
  );
}

// Firework launch spots on the left and right of the window — horizontal offset,
// apex height, and burst timing vary so they fire out of sync. Decorative only.
const FIREWORKS = [
  { side: "left" as const, off: "8%", rise: "120px", delay: "0s" },
  { side: "left" as const, off: "18%", rise: "150px", delay: "1.1s" },
  { side: "right" as const, off: "8%", rise: "135px", delay: "0.55s" },
  { side: "right" as const, off: "18%", rise: "105px", delay: "1.6s" },
];

export async function TodayPodium() {
  // Public-video dubs only; empty on a quiet day (podium shows placeholder tiles).
  let top: PodiumClip[] = [];
  try {
    top = await getTopClipsToday(3);
  } catch {
    /* DB momentarily unreachable — fall back to an empty podium */
  }
  const [first, second, third] = top;

  return (
    <aside className="g-podium min-w-0 flex-[2] self-stretch">
      <h2 className="g-title">Clips of Today</h2>

      <div className="g-panel relative flex min-h-[320px] flex-1 items-end justify-center">
        {/* Little fireworks launching from the bottom on the left and right. */}
        {FIREWORKS.map((f, i) => (
          <span
            key={i}
            className="g-fw"
            style={
              {
                [f.side]: f.off,
                "--rise": f.rise,
                "--d": f.delay,
              } as CSSProperties
            }
          >
            <span className="g-fw-rocket" />
            <span className="g-fw-burst" />
          </span>
        ))}

        {/* Podium: 2nd | 1st | 3rd, on a common baseline. Capped + centred so it
            stays a tidy podium inside the full-width window. */}
        <div className="relative z-10 flex w-full max-w-[560px] items-end justify-center gap-6">
          <Step rank={2} clip={second} />
          <Step rank={1} clip={first} />
          <Step rank={3} clip={third} />
        </div>
      </div>
    </aside>
  );
}
