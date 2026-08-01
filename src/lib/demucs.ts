// Client for the Demucs source-separation service (see the ml-service droplet).
// Its only job here: take a full-scene audio track and return the "no_vocals"
// stem — the original music + FX with dialogue removed — which we cache as the
// per-source music bed. Separation is slow (CPU), so callers run this off the
// request path (see bed.server.ts + `after`).

import { Agent, fetch as undiciFetch } from "undici";

const URL_BASE = process.env.DEMUCS_URL?.replace(/\/+$/, "");
const API_KEY = process.env.DEMUCS_API_KEY;

// A generous ceiling: CPU separation runs ~2.6x realtime, so even a long scene
// finishes well inside this. Guards against a hung upstream holding a slot.
const TIMEOUT_MS = 20 * 60 * 1000;

// Demucs holds the connection open (no response headers) for the *whole*
// separation — minutes. Node's global fetch (undici) defaults headersTimeout /
// bodyTimeout to 300s and would abort with an opaque "fetch failed" long before
// the job finishes. Disable those here and let the AbortController be the only
// cap. connectTimeout still guards a dead host. Built lazily so importing this
// module (e.g. during `next build` page-data collection) has no side effects.
let _dispatcher: Agent | null = null;
function dispatcher(): Agent {
  if (!_dispatcher) {
    _dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 10_000 });
  }
  return _dispatcher;
}

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

  // Build the multipart/form-data body by hand. Relying on global FormData/Blob
  // with undici's fetch dropped the file field (server saw no "file"); a manual
  // Buffer body is deterministic and parses cleanly as FastAPI's UploadFile.
  const boundary = `----voicer${Math.random().toString(16).slice(2)}`;
  const CRLF = "\r\n";
  const head = Buffer.from(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: application/octet-stream${CRLF}${CRLF}`,
  );
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  const body = Buffer.concat([head, audio, tail]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Use undici's own fetch (not Node's global fetch) so the Agent above — from
    // the same undici — is a compatible dispatcher. Mixing the standalone undici
    // Agent into Node's built-in fetch throws an opaque "fetch failed".
    const res = await undiciFetch(`${URL_BASE}/separate?stem=${stem}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: controller.signal,
      dispatcher: dispatcher(),
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
