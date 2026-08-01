import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";

// Prefer an explicit override (useful when a system ffmpeg is installed), else
// the bundled static binary. `ffmpeg-static` must stay out of the Next server
// bundle (see serverExternalPackages) so this path resolves to a real file.
const FFMPEG = process.env.FFMPEG_PATH || (ffmpegStatic as string | null);

// Run ffmpeg with the given args, rejecting on a non-zero exit.
function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) {
      reject(new Error("ffmpeg binary not found. Set FFMPEG_PATH or install ffmpeg-static."));
      return;
    }
    const proc = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

// A scratch dir + the source file written to disk, for a batch of operations.
export async function withSourceFile<T>(
  source: Buffer,
  ext: string,
  fn: (paths: { dir: string; input: string }) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "voicer-"));
  const input = join(dir, `source.${ext}`);
  await writeFile(input, source);
  try {
    return await fn({ dir, input });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Cut [startMs, endMs) from the source into an mp4. Re-encodes so cuts land on
// exact frames (stream-copy would snap to keyframes and drift).
export async function cutSegment(
  input: string,
  dir: string,
  index: number,
  startMs: number,
  endMs: number,
): Promise<Buffer> {
  const out = join(dir, `part-${index}.mp4`);
  const start = (startMs / 1000).toFixed(3);
  const dur = ((endMs - startMs) / 1000).toFixed(3);
  await run([
    "-y",
    "-ss", start,
    "-i", input,
    "-t", dur,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-c:a", "aac",
    "-movflags", "+faststart",
    out,
  ]);
  return readFile(out);
}

// Extract the full audio track as 44.1k stereo WAV (what Demucs wants, and what
// the render pipeline slices the music bed from).
export async function extractAudio(input: string, out: string): Promise<Buffer> {
  await run(["-y", "-i", input, "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", out]);
  return readFile(out);
}

// A recorded dub take placed on the timeline of the source video.
export type DubTake = { path: string; startMs: number; endMs: number };

export type MuxOptions = {
  // Path to the Demucs music bed (no_vocals, full-length, time-aligned with the
  // source). When present, each dubbed sector plays the original music under the
  // take instead of going silent. Omit to keep the legacy mute-only behaviour.
  bedPath?: string | null;
  // Duck the music under the voice (sidechain compression). Default: true.
  duck?: boolean;
};

// Normalise every branch to one format so amix / sidechaincompress agree.
const AF = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";

// Produce the final full-length video: keep the original video stream, and in
// each dubbed sector replace the original dialogue with the recorded take. With
// a bed, the original *music* is preserved under the take; without one, the
// sector is simply muted then voiced (original audio outside sectors is always
// left untouched).
export async function muxDub(
  input: string,
  takes: DubTake[],
  out: string,
  opts: MuxOptions = {},
): Promise<Buffer> {
  if (takes.length === 0) throw new Error("No dub takes to mux.");
  const useBed = !!opts.bedPath;
  const duck = opts.duck !== false;

  const args: string[] = ["-y", "-i", input];
  for (const t of takes) args.push("-i", t.path);
  if (useBed) args.push("-i", opts.bedPath as string);
  const bedIdx = takes.length + 1; // input index of the bed (video=0, takes=1..N)

  // Mute the original audio during every dubbed sector (OR of time ranges).
  const ranges = takes
    .map((t) => `between(t,${(t.startMs / 1000).toFixed(3)},${(t.endMs / 1000).toFixed(3)})`)
    .join("+");
  const parts = [`[0:a]${AF},volume=0:enable='${ranges}'[base]`];
  const mix = ["[base]"];

  takes.forEach((t, i) => {
    const startS = (t.startMs / 1000).toFixed(3);
    const endS = (t.endMs / 1000).toFixed(3);
    const dur = ((t.endMs - t.startMs) / 1000).toFixed(3);
    const delay = Math.max(0, Math.round(t.startMs));
    const voice = `[${i + 1}:a]${AF},atrim=0:${dur},asetpts=PTS-STARTPTS,adelay=${delay}:all=1`;

    if (useBed && duck) {
      // Voice is split: one copy keys the compressor, one goes into the mix.
      parts.push(`${voice},asplit=2[v${i}a][v${i}b]`);
      parts.push(
        `[${bedIdx}:a]${AF},atrim=${startS}:${endS},asetpts=PTS-STARTPTS,adelay=${delay}:all=1[b${i}]`,
      );
      parts.push(`[b${i}][v${i}a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=250[d${i}]`);
      mix.push(`[v${i}b]`, `[d${i}]`);
    } else if (useBed) {
      parts.push(`${voice}[v${i}]`);
      parts.push(
        `[${bedIdx}:a]${AF},atrim=${startS}:${endS},asetpts=PTS-STARTPTS,adelay=${delay}:all=1[b${i}]`,
      );
      mix.push(`[v${i}]`, `[b${i}]`);
    } else {
      parts.push(`${voice}[v${i}]`);
      mix.push(`[v${i}]`);
    }
  });

  // Sum them (normalize=0 keeps levels: base is 0 inside sectors; the take/bed
  // branches are silent outside their window, so they don't fight).
  parts.push(`${mix.join("")}amix=inputs=${mix.length}:normalize=0[aout]`);

  args.push(
    "-filter_complex", parts.join(";"),
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy", // reuse the original video stream (fast, lossless)
    "-c:a", "aac",
    "-movflags", "+faststart",
    out,
  );
  await run(args);
  return readFile(out);
}
