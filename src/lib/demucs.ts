// Client for the Demucs source-separation service (see the ml-service droplet).
// Its only job here: take a full-scene audio track and return the "no_vocals"
// stem — the original music + FX with dialogue removed — which we cache as the
// per-source music bed. Separation is slow (CPU), so callers run this off the
// request path (see bed.server.ts + `after`).

const URL_BASE = process.env.DEMUCS_URL?.replace(/\/+$/, "");
const API_KEY = process.env.DEMUCS_API_KEY;

// A generous ceiling: CPU separation runs ~2.6x realtime, so even a long scene
// finishes well inside this. Guards against a hung upstream holding a slot.
const TIMEOUT_MS = 20 * 60 * 1000;

export function demucsConfigured(): boolean {
  return !!(URL_BASE && API_KEY);
}

// Separate `audio` and return the requested stem as a WAV buffer.
// `stem`: "no_vocals" (music bed, default) | "vocals" | "both" (zip).
export async function separateStem(
  audio: Buffer,
  filename = "scene.wav",
  stem: "no_vocals" | "vocals" = "no_vocals",
): Promise<Buffer> {
  if (!demucsConfigured()) {
    throw new Error("Demucs is not configured (DEMUCS_URL / DEMUCS_API_KEY).");
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), filename);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${URL_BASE}/separate?stem=${stem}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Demucs ${res.status}: ${detail.slice(0, 300)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// Convenience: the music bed (vocals removed) for a scene's audio.
export function separateBed(audio: Buffer, filename = "scene.wav"): Promise<Buffer> {
  return separateStem(audio, filename, "no_vocals");
}
