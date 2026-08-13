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

// Substrings ffmpeg prints when the INPUT itself is unusable — truncated,
// corrupt, or not really a decodable video — as opposed to a transient or
// environmental failure (network, missing binary, disk). These are PERMANENT:
// re-running ffmpeg on the same bytes will always fail the same way, so callers
// should give up instead of retrying forever. Matched case-insensitively.
const PERMANENT_INPUT_ERRORS = [
  "moov atom not found",
  "invalid data found when processing input",
  "could not find codec parameters",
  "does not contain any stream",
  "error while decoding stream",
  "invalid nal unit size",
  "error reading header",
];

// True when an ffmpeg failure is due to the input file being corrupt/unreadable
// (not a transient/env problem). Lets callers mark such a source terminally bad
// instead of retrying it on every sweep.
export function isPermanentInputError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return PERMANENT_INPUT_ERRORS.some((s) => msg.includes(s));
}

// Cheaply verify ffmpeg can open and decode a source (a local path OR an http(s)
// URL). Reads only the container header plus a moment of audio, so it's fast even
// for a large remote file and streams almost nothing. Throws the usual ffmpeg
// error on a corrupt/truncated input (e.g. "moov atom not found"), which
// isPermanentInputError() then recognises. Use this to reject bad uploads at the
// door before they enter the pipeline.
export async function assertReadable(input: string): Promise<void> {
  await run(["-v", "error", "-xerror", "-i", input, "-t", "0.1", "-f", "null", "-"]);
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
  // Path to the Demucs music/FX bed: the original audio with the actor vocals
  // removed (music + background noise), full-length and time-aligned with the
  // source. When present it becomes the CONTINUOUS base of the mix, so the
  // original dialogue is gone everywhere and only the dub is heard as voice.
  bedPath?: string | null;
};

// Normalise every branch to one format so amix agrees on layout/rate.
const AF = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";

// Produce the final full-length video: keep the original video stream, use the
// vocals-removed bed (original music + background noise, no actor dialogue) as
// the continuous audio base for the WHOLE clip, and overlay each recorded dub
// take on top in its sector. Because the background is the same source
// end-to-end, there are no per-sector separation artifacts, and the only voices
// heard are the dubs. Without a bed we fall back to the untouched original audio
// (actor voices remain) so a render still succeeds.
export async function muxDub(
  input: string,
  takes: DubTake[],
  out: string,
  opts: MuxOptions = {},
): Promise<Buffer> {
  if (takes.length === 0) throw new Error("No dub takes to mux.");
  const useBed = !!opts.bedPath;

  const args: string[] = ["-y", "-i", input];
  for (const t of takes) args.push("-i", t.path);
  if (useBed) args.push("-i", opts.bedPath as string);
  const bedIdx = takes.length + 1; // input index of the bed (video=0, takes=1..N)

  // Base of the mix: the full-length vocals-removed bed when available (actor
  // voices gone, background continuous), otherwise the original audio track.
  const baseSrc = useBed ? `${bedIdx}:a` : "0:a";
  const parts = [`[${baseSrc}]${AF}[base]`];
  const mix = ["[base]"];

  takes.forEach((t, i) => {
    const dur = ((t.endMs - t.startMs) / 1000).toFixed(3);
    const delay = Math.max(0, Math.round(t.startMs));
    // Trim the take to its length, then park it at its start on the timeline.
    parts.push(`[${i + 1}:a]${AF},atrim=0:${dur},asetpts=PTS-STARTPTS,adelay=${delay}:all=1[v${i}]`);
    mix.push(`[v${i}]`);
  });

  // Sum base + takes (normalize=0 keeps levels: each take is silent outside its
  // own window, so it only adds the dub voice on top of the background there).
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
