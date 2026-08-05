// Claude turns timestamped sentences into dub sectors. It reads the dialogue and
// decides two things: who speaks each sentence, and how to group consecutive
// sentences into natural, dubbable sectors. It returns sentence ranges (not
// timestamps), so the actual start/end always come from the real ASR timings —
// the model never invents a timestamp.
//
// Optional: if ANTHROPIC_API_KEY isn't set (or the call fails), the caller falls
// back to one sector per sentence.

import Anthropic from "@anthropic-ai/sdk";
import type { AsrSentence } from "@/lib/asr";
import { MAX_PLAYERS } from "@/lib/room-code";

export function sectorLlmConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export type Sector = {
  startMs: number;
  endMs: number;
  label: string;
  transcript: string;
  emotionTag: string;
  player: number;
};

// Assemble sectors from sentence-index ranges + a player per range. Timestamps
// and text come from the real sentences; players are remapped to seats 1..N by
// first appearance so the first voice heard is Player 1.
function assemble(sentences: AsrSentence[], groups: { start: number; end: number; player: number }[]): Sector[] {
  const seat = new Map<number, number>();
  const seatFor = (p: number) => {
    const e = seat.get(p);
    if (e) return e;
    const v = Math.min(MAX_PLAYERS, seat.size + 1);
    seat.set(p, v);
    return v;
  };
  const out: Sector[] = [];
  for (const g of groups) {
    const start = Math.max(0, Math.min(g.start, sentences.length - 1));
    const end = Math.max(start, Math.min(g.end, sentences.length - 1));
    const slice = sentences.slice(start, end + 1);
    const transcript = slice.map((s) => s.text).join(" ").trim();
    if (!transcript) continue;
    out.push({
      startMs: slice[0].startMs,
      endMs: slice[slice.length - 1].endMs,
      label: "",
      transcript,
      emotionTag: "",
      player: seatFor(g.player),
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

// One sector per sentence — the fallback when Claude isn't available.
function oneEach(sentences: AsrSentence[]): Sector[] {
  return sentences.map((s) => ({
    startMs: s.startMs,
    endMs: s.endMs,
    label: "",
    transcript: s.text,
    emotionTag: "",
    player: 1,
  }));
}

export async function makeSectors(sentences: AsrSentence[], expectedSpeakers?: number): Promise<Sector[]> {
  if (sentences.length === 0) return [];
  if (!sectorLlmConfigured()) return oneEach(sentences);

  const numbered = sentences
    .map((s, i) => `${i}\t[${(s.startMs / 1000).toFixed(1)}s] ${s.text}`)
    .join("\n");

  const speakerHint = expectedSpeakers && expectedSpeakers >= 1
    ? `The scene has about ${expectedSpeakers} distinct speakers.`
    : "Work out how many distinct speakers there are.";

  const system =
    "You are cutting a movie scene into sectors so players can dub it. You are " +
    "given the scene's sentences in time order, each with an index and start " +
    "time. Do two things: (1) decide who speaks each sentence, using the meaning " +
    "of the dialogue — who is addressed by name, pronouns, turn-taking; (2) group " +
    "consecutive sentences into sectors. A sector is one person's continuous run " +
    "of speech; start a new sector whenever the speaker changes, or when a single " +
    "speaker's run gets too long to perform comfortably in one take (aim for a " +
    "few seconds, at most ~6). Never put two different people in one sector. " +
    "Cover every sentence exactly once, in order, with contiguous index ranges. " +
    "Number the speakers starting at 1 and reuse the same number for the same " +
    "person throughout.";

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system,
      messages: [
        {
          role: "user",
          content: `${speakerHint}\n\nSentences (index, start time, text):\n${numbered}\n\nReturn the sectors as contiguous index ranges, each with the speaker number.`,
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              sectors: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    start: { type: "integer" },
                    end: { type: "integer" },
                    player: { type: "integer" },
                  },
                  required: ["start", "end", "player"],
                },
              },
            },
            required: ["sectors"],
          },
        },
      },
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return oneEach(sentences);
    const parsed = JSON.parse(textBlock.text) as { sectors: { start: number; end: number; player: number }[] };
    const sectors = assemble(sentences, parsed.sectors);
    return sectors.length > 0 ? sectors : oneEach(sentences);
  } catch {
    return oneEach(sentences);
  }
}
