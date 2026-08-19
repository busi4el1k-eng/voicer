import { NextResponse, type NextRequest } from "next/server";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import db from "@/lib/db";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";
import { SPACES_PREFIX, getObjectBuffer, putObject, spacesConfigured } from "@/lib/spaces";
import { muxDub, withSourceFile, type DubTake } from "@/lib/ffmpeg";
import { analyzeTakes, recordPublicClip, type AggFeatures } from "@/lib/perf-clip";
import { ensureBedForUpload } from "@/lib/bed.server";
import { RenderBusyError, withRenderSlot } from "@/lib/render-queue";
import { emitRoom } from "@/lib/room-events";
import { ClientError, toClientMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

// The host renders the final party dub: gather every player's submitted take,
// mux them into the source video (same pipeline as the solo dub), publish the
// result, and flip the room to "finished" so everyone can watch it.
export async function POST(req: NextRequest) {
  if (!spacesConfigured()) {
    return NextResponse.json({ error: "Storage isn't configured." }, { status: 500 });
  }

  const { code: rawCode, playerId } = (await req.json().catch(() => ({}))) as {
    code?: string;
    playerId?: string;
  };
  const code = normalizeRoomCode(rawCode ?? "");
  if (!code || !playerId) {
    return NextResponse.json({ error: "Missing room or player." }, { status: 400 });
  }

  const room = await db.room.findUnique({ where: { code }, include: { players: true } });
  if (!room) return NextResponse.json({ error: "Room closed." }, { status: 404 });

  const me = room.players.find((p) => p.id === playerId);
  if (!me) return NextResponse.json({ error: "You're not in this room." }, { status: 403 });
  if (!me.isHost) {
    return NextResponse.json({ error: "Only the host can finish the game." }, { status: 403 });
  }
  if (!room.players.every((p) => p.status === "finished")) {
    return NextResponse.json({ error: "Waiting for all players to finish." }, { status: 409 });
  }
  if (!room.videoUploadId) {
    return NextResponse.json({ error: "No video selected." }, { status: 409 });
  }

  const upload = await db.videoUpload.findUnique({
    where: { id: room.videoUploadId },
    include: { segments: { orderBy: { index: "asc" } } },
  });
  if (!upload) return NextResponse.json({ error: "Video not found." }, { status: 404 });

  // Duel renders each player's OWN dub of the whole video (separate result videos)
  // and decides a winner by capture score — a different pipeline from the party's
  // single combined render below.
  if (room.mode === "duel") {
    return renderDuel(code, room.players, upload);
  }

  const roomTakes = await db.roomTake.findMany({ where: { roomCode: code } });
  const takeByseg = new Map(roomTakes.map((t) => [t.segmentId, t]));

  try {
    // Gate the heavy work (load source into RAM + ffmpeg) behind the render
    // limiter so simultaneous "finish game" clicks can't saturate the host.
    const url = await withRenderSlot(async () => {
      const src = await getObjectBuffer(upload.sourceKey);
      const ext = upload.sourceKey.split(".").pop() || "mp4";

      const { outBuf, features } = await withSourceFile(src, ext, async ({ dir, input }) => {
        const takes: DubTake[] = [];
        let i = 0;
        for (const seg of upload.segments) {
          const rt = takeByseg.get(seg.id);
          if (!rt) continue; // sector nobody dubbed — leave the original audio
          const buf = await getObjectBuffer(rt.partKey);
          const path = join(dir, `take-${i}.webm`);
          await writeFile(path, buf);
          takes.push({ path, startMs: seg.startMs, endMs: seg.endMs });
          i++;
        }
        if (takes.length === 0) throw new ClientError("No recorded takes to combine.");

        // Use the vocals-removed bed (music + noise, no actor voices) as the
        // continuous background so only the dubs are heard. Generate it inline now
        // if it isn't ready yet, so the render never silently keeps the original
        // dialogue; only fall back to the original audio if a bed truly can't be
        // produced (Demucs/Storage unconfigured or separation failed).
        let bedPath: string | null = null;
        const bedKey = await ensureBedForUpload(upload.id);
        if (bedKey) {
          bedPath = join(dir, "bed.wav");
          await writeFile(bedPath, await getObjectBuffer(bedKey));
        }

        // Score the performance from the raw voice takes (podium), but only for
        // public videos — no point spending CPU on dubs that can't be shown.
        let features: AggFeatures | null = null;
        if (upload.visibility === "public") features = await analyzeTakes(takes);

        const out = join(dir, "party-dub.mp4");
        return { outBuf: await muxDub(input, takes, out, { bedPath }), features };
      });

      const key = `${SPACES_PREFIX}rooms/${code}/final/${Date.now()}.mp4`;
      const { url } = await putObject(key, outBuf, "video/mp4");
      await db.room.update({ where: { code }, data: { finalUrl: url, status: "finished" } });
      // Enter the public dub into the "Clips of Today" podium (no-op if private).
      // Authors = the party's player names.
      const author = room.players
        .map((p) => p.displayName)
        .filter(Boolean)
        .slice(0, 4)
        .join(", ");
      void recordPublicClip({
        uploadId: upload.id,
        visibility: upload.visibility,
        videoUrl: url,
        mode: "party",
        author,
        features,
      }).catch(() => {});
      emitRoom(code); // everyone's screen flips to the finished result
      return url;
    });

    return NextResponse.json({ url, room: await roomView(code) });
  } catch (e) {
    // Queue full — tell the client to retry shortly rather than fail outright.
    const status = e instanceof RenderBusyError ? 503 : 500;
    return NextResponse.json(
      { error: toClientMessage(e, "Render failed. Please try again.") },
      { status },
    );
  }
}

// The minimal shapes renderDuel needs from the loaded room/upload.
type DuelPlayer = {
  id: string;
  displayName: string;
  matchAvg: number | null;
  userId: string | null; // null for guests — only signed-in wins are counted
};
type DuelUpload = {
  id: string;
  sourceKey: string;
  visibility: string;
  segments: { id: string; startMs: number; endMs: number }[];
};

// Duel render: both players dubbed the WHOLE video, each keeping their own takes
// (DuelTake). We render one result video PER player (their takes over the shared
// source + music bed), store it on their RoomPlayer.finalUrl, then flip the room
// to "finished". The winner (higher capture score) enters the "Clips of Today"
// podium. Source + bed are loaded once and reused for both renders.
async function renderDuel(code: string, players: DuelPlayer[], upload: DuelUpload) {
  const duelTakes = await db.duelTake.findMany({ where: { roomCode: code } });
  if (duelTakes.length === 0) {
    return NextResponse.json({ error: "No recorded takes to combine." }, { status: 409 });
  }

  try {
    const rendered = await withRenderSlot(async () => {
      const src = await getObjectBuffer(upload.sourceKey);
      const ext = upload.sourceKey.split(".").pop() || "mp4";

      // Render every player inside a single source-file context so the input clip
      // and the (once-generated) music bed are shared across both passes.
      const results = await withSourceFile(src, ext, async ({ dir, input }) => {
        let bedPath: string | null = null;
        const bedKey = await ensureBedForUpload(upload.id);
        if (bedKey) {
          bedPath = join(dir, "bed.wav");
          await writeFile(bedPath, await getObjectBuffer(bedKey));
        }

        const out: { playerId: string; outBuf: Buffer | null; features: AggFeatures | null }[] = [];
        for (const p of players) {
          const mineBySeg = new Map(
            duelTakes.filter((t) => t.playerId === p.id).map((t) => [t.segmentId, t]),
          );
          const takes: DubTake[] = [];
          let i = 0;
          for (const seg of upload.segments) {
            const rt = mineBySeg.get(seg.id);
            if (!rt) continue; // sector this player didn't dub — keep the original audio
            const buf = await getObjectBuffer(rt.partKey);
            const path = join(dir, `take-${p.id}-${i}.webm`);
            await writeFile(path, buf);
            takes.push({ path, startMs: seg.startMs, endMs: seg.endMs });
            i++;
          }
          if (takes.length === 0) {
            out.push({ playerId: p.id, outBuf: null, features: null });
            continue;
          }
          const features = upload.visibility === "public" ? await analyzeTakes(takes) : null;
          const path = join(dir, `duel-${p.id}.mp4`);
          out.push({ playerId: p.id, outBuf: await muxDub(input, takes, path, { bedPath }), features });
        }
        return out;
      });

      // Publish each player's dub and record it on their seat.
      const urls: { playerId: string; url: string; features: AggFeatures | null }[] = [];
      for (const r of results) {
        if (!r.outBuf) {
          urls.push({ playerId: r.playerId, url: "", features: null });
          continue;
        }
        const key = `${SPACES_PREFIX}rooms/${code}/duel/${r.playerId}/final/${Date.now()}.mp4`;
        const { url } = await putObject(key, r.outBuf, "video/mp4");
        urls.push({ playerId: r.playerId, url, features: r.features });
      }

      if (urls.every((u) => !u.url)) throw new ClientError("No recorded takes to combine.");

      await db.$transaction([
        ...urls
          .filter((u) => u.url)
          .map((u) => db.roomPlayer.update({ where: { id: u.playerId }, data: { finalUrl: u.url } })),
        db.room.update({ where: { code }, data: { status: "finished" } }),
      ]);

      // The winner (higher capture score) with a rendered dub goes on the podium.
      const winner = [...players]
        .filter((p) => urls.find((u) => u.playerId === p.id)?.url)
        .sort((a, b) => (b.matchAvg ?? 0) - (a.matchAvg ?? 0))[0];
      const winUrl = winner && urls.find((u) => u.playerId === winner.id);
      if (winner && winUrl?.url) {
        void recordPublicClip({
          uploadId: upload.id,
          visibility: upload.visibility,
          videoUrl: winUrl.url,
          mode: "party",
          author: winner.displayName,
          features: winUrl.features,
        }).catch(() => {});
      }

      // Credit the duel win (a "crown" on the dashboard) to every signed-in
      // player who has a rendered dub and shares the top capture score — a tie
      // crowns both. Requires a real head-to-head (2+ rendered dubs) and a
      // non-zero top score, so a walkover or an unscored game hands out nothing.
      // upsert on (roomCode,userId) keeps a re-render from double-counting.
      const contenders = players.filter((p) => urls.find((u) => u.playerId === p.id)?.url);
      if (contenders.length >= 2) {
        const top = Math.max(...contenders.map((p) => p.matchAvg ?? 0));
        const winnerUserIds = contenders
          .filter((p) => (p.matchAvg ?? 0) === top && p.userId)
          .map((p) => p.userId as string);
        if (top > 0 && winnerUserIds.length > 0) {
          void db
            .$transaction(
              winnerUserIds.map((uid) =>
                db.duelWin.upsert({
                  where: { roomCode_userId: { roomCode: code, userId: uid } },
                  create: { roomCode: code, userId: uid },
                  update: {},
                }),
              ),
            )
            .catch(() => {});
        }
      }

      emitRoom(code); // every duelist's screen flips to the head-to-head result
      return urls;
    });

    return NextResponse.json({ rendered, room: await roomView(code) });
  } catch (e) {
    const status = e instanceof RenderBusyError ? 503 : 500;
    return NextResponse.json(
      { error: toClientMessage(e, "Render failed. Please try again.") },
      { status },
    );
  }
}
