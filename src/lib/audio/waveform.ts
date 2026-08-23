// Client-side audio helpers shared by the solo run: decode a clip and reduce it
// to a fixed-length amplitude envelope (the little bars in the waveform views).

export type Pcm = { data: Float32Array; rate: number };

export async function decodeAudio(src: Blob | string): Promise<Pcm> {
  const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
  const buf = await blob.arrayBuffer();
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new Ctx();
  const audio = await ac.decodeAudioData(buf);
  await ac.close();
  return { data: audio.getChannelData(0), rate: audio.sampleRate };
}

// Peak amplitude in each of `n` equal buckets across [from, to] (sample indices).
export function envelope(data: Float32Array, from: number, to: number, n: number): number[] {
  const len = Math.max(1, to - from);
  const step = Math.max(1, Math.floor(len / n));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let peak = 0;
    const base = from + i * step;
    for (let j = 0; j < step; j++) {
      const v = data[base + j];
      if (v) peak = Math.max(peak, Math.abs(v));
    }
    out.push(peak);
  }
  return out;
}
