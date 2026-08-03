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
import type { ClientRequest } from "node:http";

const URL_BASE = process.env.DEMUCS_URL?.replace(/\/+$/, "");
const API_KEY = process.env.DEMUCS_API_KEY;

// Connection stability (see "sometimes no connection" freezes):
//  - We never cap the *processing* time: CPU runs ~2.6x realtime, so long videos
//    take many minutes and node:http has no default socket timeout — the request
//    just waits for Demucs to respond.
//  - But a bare request also waits forever on a connection that never opens or
//    that silently dies mid-wait. So we add a connect-phase timeout, TCP
//    keep-alive (so a dead peer surfaces as an error instead of an infinite
//    hang), and a couple of retries for transient network failures.
const CONNECT_TIMEOUT_MS = 20_000; // time allowed to establish the TCP connection
const KEEPALIVE_MS = 15_000; // start probing an idle socket after this long
const MAX_ATTEMPTS = 3; // total tries on transient connection errors
const RETRY_BASE_MS = 2_000; // backoff grows: 2s, 4s, …

export function demucsConfigured(): boolean {
  return !!(URL_BASE && API_KEY);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A network hiccup we can safely retry (connect refused/reset/timeout, DNS
// blips, dead-peer keep-alive drops) — as opposed to a real Demucs HTTP error.
function isRetryable(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ECONNTIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  );
}

// One separation attempt over a single connection.
function attemptSeparate(
  audio: Buffer,
  filename: string,
  stem: "no_vocals" | "vocals",
): Promise<Buffer> {
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
    const req: ClientRequest = requestFn(
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
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            reject(new Error(`Demucs ${res.statusCode}: ${buf.toString("utf8").slice(0, 300)}`));
          } else {
            resolve(buf);
          }
        });
      },
    );

    // Keep-alive turns a silently-dropped connection (common on the long,
    // response-less wait) into an 'error' we can retry, instead of a dead hang.
    // The connect timer only guards the TCP handshake and is cleared once the
    // socket connects — it must not fire during the minutes-long processing.
    req.on("socket", (socket) => {
      socket.setKeepAlive(true, KEEPALIVE_MS);
      if (socket.connecting) {
        const timer = setTimeout(() => {
          const err = Object.assign(new Error("Demucs connection timed out"), {
            code: "ECONNTIMEOUT",
          });
          req.destroy(err);
        }, CONNECT_TIMEOUT_MS);
        const clear = () => clearTimeout(timer);
        socket.once("connect", clear);
        socket.once("error", clear);
        socket.once("close", clear);
      }
    });

    req.on("error", (e) => reject(e));
    req.write(body);
    req.end();
  });
}

// Separate `audio` and return the requested stem as a WAV buffer, retrying a
// few times on transient connection failures.
// `stem`: "no_vocals" (music bed, default) | "vocals".
export async function separateStem(
  audio: Buffer,
  filename = "scene.wav",
  stem: "no_vocals" | "vocals" = "no_vocals",
): Promise<Buffer> {
  if (!demucsConfigured()) {
    throw new Error("Demucs is not configured (DEMUCS_URL / DEMUCS_API_KEY).");
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptSeparate(audio, filename, stem);
    } catch (e) {
      lastErr = e;
      // A real Demucs error (non-200) or the last attempt — give up now.
      if (!isRetryable(e) || attempt === MAX_ATTEMPTS) throw e;
      console.warn(
        `[demucs] transient error (attempt ${attempt}/${MAX_ATTEMPTS}), retrying:`,
        (e as { code?: string })?.code ?? e,
      );
      await delay(RETRY_BASE_MS * attempt);
    }
  }
  throw lastErr;
}

// Convenience: the music bed (vocals removed) for a scene's audio.
export function separateBed(audio: Buffer, filename = "scene.wav"): Promise<Buffer> {
  return separateStem(audio, filename, "no_vocals");
}
