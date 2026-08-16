// Client-side "how close was my dub to the original?" scoring for the solo run.
// Pure math (no AI, no upload): we compare the loudness ENVELOPE of the player's
// recording to the original sector's envelope. High correlation = they got loud
// and soft at the same moments = they matched the original's timing, rhythm and
// emphasis. We deliberately ignore absolute loudness (mic gain differs) and words
// (that would need speech recognition) — only the delivery shape is compared.

import { envelope } from "@/lib/audio/waveform";

// Buckets per sector: fine enough to catch phrasing, coarse enough to be robust
// to tiny timing jitter.
const BUCKETS = 64;
// Below this peak the take is effectively silence — don't score correlation on
// noise. Kept low so a quiet mic / quiet original still counts (the envelopes are
// scale-invariant, so loudness itself never decides the score).
const SILENCE_PEAK = 0.004;
// Easing exponent applied to the correlation before showing it as a %. < 1 lifts
// the middle of the range so a genuine attempt feels rewarded — a raw 0.5
// correlation is actually a decent human imitation, and this shows it as ~71%.
const EASE = 0.5;

// Pearson correlation of two equal-length series. Invariant to scale and offset,
// so it measures pure shape/timing agreement, not loudness. Returns 0 when either
// series is flat (no variation to correlate).
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den < 1e-9 ? 0 : num / den;
}

// Light 3-tap moving average — softens tiny timing jitter so a near-miss isn't
// punished, which makes the score more forgiving.
function smooth(v: number[]): number[] {
  const out = v.slice();
  for (let i = 0; i < v.length; i++) {
    const a = v[i - 1] ?? v[i];
    const c = v[i + 1] ?? v[i];
    out[i] = (a + v[i] + c) / 3;
  }
  return out;
}

// Similarity of a recorded take to its original sector audio, as a 0–100%
// "match". Both signals are reduced to a fixed-length loudness envelope (which
// also normalises their different durations/sample-rates onto one timeline),
// smoothed, then correlated. The correlation is eased so a genuine attempt reads
// as an encouraging score rather than a harsh one. A near-silent take scores 0.
export function sectorMatch(orig: Float32Array, take: Float32Array): number {
  if (!orig || !take || orig.length === 0 || take.length === 0) return 0;
  const a = smooth(envelope(orig, 0, orig.length, BUCKETS));
  const b = smooth(envelope(take, 0, take.length, BUCKETS));
  if (Math.max(...b) < SILENCE_PEAK) return 0;
  const corr = Math.max(0, pearson(a, b));
  return Math.round(Math.pow(corr, EASE) * 100);
}
