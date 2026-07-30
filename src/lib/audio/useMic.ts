"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecordResult = { blob: Blob; url: string; durationMs: number };

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

// Minimal mic: open a stream, expose a live 0..1 level, record for a duration.
export function useMic() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [recording, setRecording] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRef = useRef(0); // latest smoothed level, readable without a re-render
  const rafRef = useRef(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const resolveRef = useRef<((r: RecordResult | null) => void) | null>(null);

  const meter = useCallback(() => {
    const a = analyserRef.current;
    if (!a) return;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    levelRef.current = levelRef.current * 0.6 + Math.min(1, rms * 3.2) * 0.4;
    setLevel(levelRef.current);
    rafRef.current = requestAnimationFrame(meter);
  }, []);

  const open = useCallback(async () => {
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyserRef.current = analyser;
      rafRef.current = requestAnimationFrame(meter);
      setReady(true);
    } catch (e) {
      const err = e as DOMException;
      setError(
        err?.name === "NotAllowedError"
          ? "Microphone was blocked. Allow it and try again."
          : "Couldn't open the microphone.",
      );
    }
  }, [meter]);

  const recordFor = useCallback((ms: number): Promise<RecordResult | null> => {
    const stream = streamRef.current;
    if (!stream) return Promise.resolve(null);
    const mime = pickMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    recRef.current = rec;
    startedRef.current = performance.now();
    setRecording(true);
    rec.start();
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setRecording(false);
        resolve({ blob, url: URL.createObjectURL(blob), durationMs: performance.now() - startedRef.current });
      };
      setTimeout(() => rec.state !== "inactive" && rec.stop(), ms);
    });
  }, []);

  // Manual recording: the caller decides when to start and stop (no timer).
  const startRec = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || recRef.current) return;
    const mime = pickMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      recRef.current = null;
      setRecording(false);
      resolveRef.current?.({
        blob,
        url: URL.createObjectURL(blob),
        durationMs: performance.now() - startedRef.current,
      });
      resolveRef.current = null;
    };
    recRef.current = rec;
    startedRef.current = performance.now();
    setRecording(true);
    rec.start();
  }, []);

  const stopRec = useCallback((): Promise<RecordResult | null> => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      rec.stop();
    });
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  const getLevel = useCallback(() => levelRef.current, []);

  return { ready, error, level, recording, open, recordFor, startRec, stopRec, getLevel };
}
