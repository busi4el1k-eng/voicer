import { NextResponse, type NextRequest } from "next/server";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import db from "@/lib/db";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";
import { SPACES_PREFIX, getObjectBuffer, putObject, spacesConfigured } from "@/lib/spaces";
import { muxDub, withSourceFile, type DubTake } from "@/lib/ffmpeg";
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

  const roomTakes = await db.roomTake.findMany({ where: { roomCode: code } });
  const takeByseg = new Map(roomTakes.map((t) => [t.segmentId, t]));

  try {
    // Gate the heavy work (load source into RAM + ffmpeg) behind the render
    // limiter so simultaneous "finish game" clicks can't saturate the host.
    const url = await withRenderSlot(async () => {
      const src = await getObjectBuffer(upload.sourceKey);
      const ext = upload.sourceKey.split(".").pop() || "mp4";

      const outBuf = await withSourceFile(src, ext, async ({ dir, input }) => {
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

        const out = join(dir, "party-dub.mp4");
        return muxDub(input, takes, out, { bedPath });
      });

      const key = `${SPACES_PREFIX}rooms/${code}/final/${Date.now()}.mp4`;
      const { url } = await putObject(key, outBuf, "video/mp4");
      await db.room.update({ where: { code }, data: { finalUrl: url, status: "finished" } });
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
