// AssemblyAI speech-to-text: transcribe audio into sentences, each with a
// millisecond timestamp. That's all we need — Claude turns these sentences into
// dub sectors (grouping + who speaks). No diarization here; Claude decides
// speakers from the text.
//
// Small and provider-shaped like demucs.ts: read config from the env, expose
// `asrConfigured()` so callers/UI degrade when unset, and normalise the shape.

const API_KEY = process.env.ASSEMBLYAI_API_KEY;
const BASE = "https://api.assemblyai.com/v2";

const POLL_INTERVAL_MS = 3_000;
const MAX_WAIT_MS = 5 * 60_000;

export function asrConfigured(): boolean {
  return !!API_KEY;
}

// One sentence of dialogue with its timing.
export type AsrSentence = { startMs: number; endMs: number; text: string };

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function uploadAudio(audio: Buffer): Promise<string> {
  // Node Buffer isn't a valid fetch BodyInit under the DOM types; hand it a
  // plain ArrayBuffer holding the audio bytes.
  const body = new ArrayBuffer(audio.byteLength);
  new Uint8Array(body).set(audio);
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: { authorization: API_KEY!, "content-type": "application/octet-stream" },
    body,
  });
  if (!res.ok) throw new Error(`AssemblyAI upload ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { upload_url } = (await res.json()) as { upload_url: string };
  return upload_url;
}

type TranscriptResponse = { id: string; status: "queued" | "processing" | "completed" | "error"; error?: string };
type SentencesResponse = { sentences?: { start: number; end: number; text: string }[] };

// Transcribe `audio` and return its dialogue as timestamped sentences.
export async function transcribeSentences(audio: Buffer): Promise<AsrSentence[]> {
  if (!asrConfigured()) throw new Error("AssemblyAI is not configured (ASSEMBLYAI_API_KEY).");

  const audioUrl = await uploadAudio(audio);

  const createRes = await fetch(`${BASE}/transcript`, {
    method: "POST",
    headers: { authorization: API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: audioUrl, punctuate: true, format_text: true }),
  });
  if (!createRes.ok) throw new Error(`AssemblyAI transcript ${createRes.status}: ${(await createRes.text()).slice(0, 300)}`);
  const created = (await createRes.json()) as TranscriptResponse;

  const deadline = Date.now() + MAX_WAIT_MS;
  let job = created;
  while (job.status !== "completed" && job.status !== "error") {
    if (Date.now() > deadline) throw new Error("AssemblyAI transcript timed out.");
    await delay(POLL_INTERVAL_MS);
    const r = await fetch(`${BASE}/transcript/${created.id}`, { headers: { authorization: API_KEY! } });
    if (!r.ok) throw new Error(`AssemblyAI poll ${r.status}: ${(await r.text()).slice(0, 300)}`);
    job = (await r.json()) as TranscriptResponse;
  }
  if (job.status === "error") throw new Error(`AssemblyAI failed: ${job.error ?? "unknown error"}`);

  const sentRes = await fetch(`${BASE}/transcript/${created.id}/sentences`, { headers: { authorization: API_KEY! } });
  if (!sentRes.ok) throw new Error(`AssemblyAI sentences ${sentRes.status}: ${(await sentRes.text()).slice(0, 300)}`);
  const { sentences } = (await sentRes.json()) as SentencesResponse;

  return (sentences ?? [])
    .map((s) => ({ startMs: Math.round(s.start), endMs: Math.round(s.end), text: s.text.trim() }))
    .filter((s) => s.text.length > 0);
}
