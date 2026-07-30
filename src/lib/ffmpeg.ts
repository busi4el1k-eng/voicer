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

// A recorded dub take placed on the timeline of the source video.
export type DubTake = { path: string; startMs: number; endMs: number };

// Produce the final full-length video: keep the original video stream, but in
// each dubbed sector mute the original audio and drop the recorded take in.
// Audio outside the sectors is left untouched.
export async function muxDub(input: string, takes: DubTake[], out: string): Promise<Buffer> {
  if (takes.length === 0) throw new Error("No dub takes to mux.");

  const args: string[] = ["-y", "-i", input];
  for (const t of takes) args.push("-i", t.path);

  // Mute the original audio during every dubbed sector (OR of time ranges).
  const ranges = takes
    .map((t) => `between(t,${(t.startMs / 1000).toFixed(3)},${(t.endMs / 1000).toFixed(3)})`)
    .join("+");
  const parts = [`[0:a]volume=0:enable='${ranges}'[base]`];

  // Trim each take to its sector length and delay it to the sector start.
  const labels = ["[base]"];
  takes.forEach((t, i) => {
    const dur = ((t.endMs - t.startMs) / 1000).toFixed(3);
    const delay = Math.max(0, Math.round(t.startMs));
    parts.push(`[${i + 1}:a]atrim=0:${dur},asetpts=PTS-STARTPTS,adelay=${delay}:all=1[t${i}]`);
    labels.push(`[t${i}]`);
  });

  // Sum them (normalize=0 keeps levels: base is 0 inside sectors, takes are 0
  // outside their window, so they don't fight).
  parts.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0[aout]`);

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
