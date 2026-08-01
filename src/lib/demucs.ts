// Client for the Demucs source-separation service (see the ml-service droplet).
// Its only job here: take a full-scene audio track and return the "no_vocals"
// stem — the original music + FX with dialogue removed — which we cache as the
// per-source music bed. Separation is slow (CPU), so callers run this off the
// request path (see bed.server.ts + `after`).
//
// Uses node:http directly (not global fetch / undici): the separation holds the
// connection open with no response for minutes, which undici's 300s
// headers/body timeout aborts as an opaque "fetch failed". A raw http request
// has no such default timeout; we cap the whole thing ourselves.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const URL_BASE = process.env.DEMUCS_URL?.replace(/\/+$/, "");
const API_KEY = process.env.DEMUCS_API_KEY;

// Generous overall cap: CPU separation runs ~2.6x realtime, so even a long scene
// finishes well inside this. Guards against a hung upstream holding the socket.
const TIMEOUT_MS = 20 * 60 * 1000;

export function demucsConfigured(): boolean {
  return !!(URL_BASE && API_KEY);
}

// Separate `audio` and return the requested stem as a WAV buffer.
// `stem`: "no_vocals" (music bed, default) | "vocals".
export function separateStem(
  audio: Buffer,
  filename = "scene.wav",
  stem: "no_vocals" | "vocals" = "no_vocals",
): Promise<Buffer> {
  if (!demucsConfigured()) {
    return Promise.reject(new Error("Demucs is not configured (DEMUCS_URL / DEMUCS_API_KEY)."));
  }

  const url = new URL(`${URL_BASE}/separate?stem=${stem}`);
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  // Hand-built multipart/form-data body (FastAPI UploadFile field "file").
  const boundary = `----voicer${Math.random().toString(16).slice(2)}`;
  const CRLF = "\r\n";
  const head = Buffer.from(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: application/octet-stream${CRLF}${CRLF}`,
  );
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  const body = Buffer.concat([head, audio, tail]);

  return new Promise<Buffer>((resolve, reject) => {
    const req = requestFn(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          clearTimeout(timer);
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            reject(new Error(`Demucs ${res.statusCode}: ${buf.toString("utf8").slice(0, 300)}`));
          } else {
            resolve(buf);
          }
        });
      },
    );

    const timer = setTimeout(() => req.destroy(new Error("Demucs request timed out")), TIMEOUT_MS);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.write(body);
    req.end();
  });
}

// Convenience: the music bed (vocals removed) for a scene's audio.
export function separateBed(audio: Buffer, filename = "scene.wav"): Promise<Buffer> {
  return separateStem(audio, filename, "no_vocals");
}
