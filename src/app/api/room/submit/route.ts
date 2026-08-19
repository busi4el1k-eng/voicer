import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";
import { emitRoom } from "@/lib/room-events";
import { assignSectors } from "@/lib/party-assign";
import { SPACES_PREFIX, putObject, spacesConfigured } from "@/lib/spaces";

export const runtime = "nodejs";
export const maxDuration = 300;

// A player submits their recorded sectors and marks themselves finished. Each
// take is a form file named `take:<segmentId>`. We verify the sector belongs to
// the room's video and is assigned to this player's seat, store it to Spaces,
// and upsert a RoomTake row. The host's render later gathers all of them.
export async function POST(req: NextRequest) {
  if (!spacesConfigured()) {
    return NextResponse.json({ error: "Storage isn't configured." }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a form upload." }, { status: 400 });
  }

  const code = normalizeRoomCode(String(form.get("code") ?? ""));
  const playerId = String(form.get("playerId") ?? "");
  if (!code || !playerId) {
    return NextResponse.json({ error: "Missing room or player." }, { status: 400 });
  }

  const room = await db.room.findUnique({
    where: { code },
    include: { players: { orderBy: [{ isHost: "desc" }, { createdAt: "asc" }] } },
  });
  if (!room) return NextResponse.json({ error: "Room closed." }, { status: 404 });
  if (room.status !== "dubbing") {
    return NextResponse.json({ error: "The game isn't in progress." }, { status: 409 });
  }

  const me = room.players.find((p) => p.id === playerId);
  if (!me) return NextResponse.json({ error: "You're not in this room." }, { status: 403 });
  // Frozen seat from select — the authoritative sector assignment. Never the
  // live roster position, which shifts if someone left mid-game.
  const seat = me.seat;
  if (!room.videoUploadId) {
    return NextResponse.json({ error: "No video selected." }, { status: 409 });
  }

  const isDuel = room.mode === "duel";

  const segments = await db.videoSegment.findMany({
    where: { uploadId: room.videoUploadId },
    select: { id: true, player: true, startMs: true, endMs: true },
  });

  // Which sectors this player is allowed to dub.
  //   • Party: the sector→seat assignment adapts to the party size (see
  //     lib/party-assign); with the seats frozen at launch ([1..seatCount]) every
  //     client and the server compute the SAME map, so a player can only upload
  //     takes for the sectors they were given.
  //   • Duel: BOTH duelists dub the WHOLE video, so every playable sector is
  //     theirs to record.
  const playable = segments.filter((s) => s.endMs > s.startMs);
  let mine: Set<string>;
  if (isDuel) {
    mine = new Set(playable.map((s) => s.id));
  } else {
    const seatUniverse = Array.from(
      { length: room.seatCount > 0 ? room.seatCount : room.players.length },
      (_, i) => i + 1,
    );
    const assignment = assignSectors(segments, seatUniverse);
    mine = new Set(segments.filter((s) => assignment.get(s.id) === seat).map((s) => s.id));
  }

  for (const [field, value] of form.entries()) {
    if (!field.startsWith("take:")) continue;
    const segmentId = field.slice("take:".length);
    if (!mine.has(segmentId)) continue; // ignore sectors not assigned to this player
    if (!(value instanceof File) || value.size === 0) continue;

    const buf = Buffer.from(await value.arrayBuffer());

    if (isDuel) {
      // Per-player storage + row so both duelists keep their own recording of the
      // same sector (RoomTake, used by party, is never touched here).
      const key = `${SPACES_PREFIX}rooms/${code}/duel/${playerId}/${segmentId}.webm`;
      const { url } = await putObject(key, buf, value.type || "audio/webm");
      await db.duelTake.upsert({
        where: { roomCode_segmentId_playerId: { roomCode: code, segmentId, playerId } },
        update: { partKey: key, partUrl: url },
        create: { roomCode: code, segmentId, playerId, partKey: key, partUrl: url },
      });
    } else {
      const key = `${SPACES_PREFIX}rooms/${code}/takes/${segmentId}.webm`;
      const { url } = await putObject(key, buf, value.type || "audio/webm");
      await db.roomTake.upsert({
        where: { roomCode_segmentId: { roomCode: code, segmentId } },
        update: { playerId, partKey: key, partUrl: url },
        create: { roomCode: code, segmentId, playerId, partKey: key, partUrl: url },
      });
    }
  }

  // The player's browser scored each of its sectors against the original and
  // sends the average (0–100). Stored so the finished result screen can show the
  // party's average across everyone. Clamped; ignored if absent/invalid.
  const rawMatch = Number(form.get("matchAvg"));
  const matchAvg = Number.isFinite(rawMatch)
    ? Math.max(0, Math.min(100, Math.round(rawMatch)))
    : null;

  await db.roomPlayer.update({
    where: { id: playerId },
    data: { status: "finished", matchAvg },
  });
  emitRoom(code); // host sees this player flip to "finished" right away
  return NextResponse.json({ room: await roomView(code) });
}
