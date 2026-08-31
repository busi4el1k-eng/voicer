import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView, normalizeRoleAssign } from "@/lib/room.server";
import { emitRoom } from "@/lib/room-events";

export const runtime = "nodejs";

// The host locks in the video for a party dub and launches the game: set the
// room's videoUploadId and flip status to "dubbing" so waiting members follow
// into the studio. Enforces the "party size must match the video's seats" rule.
export async function POST(req: NextRequest) {
  const { code: rawCode, playerId, uploadId, mode: rawMode, roleAssign: rawRoleAssign } = (await req
    .json()
    .catch(() => ({}))) as {
    code?: string;
    playerId?: string;
    uploadId?: string;
    mode?: string;
    roleAssign?: unknown;
  };
  // Optional: the game type to lock in for this launch (from the library
  // chooser). Only 'party'|'duel' are valid; anything else is ignored and the
  // room keeps whatever mode it already had (e.g. chosen on the dashboard).
  const mode = rawMode === "duel" || rawMode === "party" ? rawMode : null;
  // Optional: the host's manual role casting for THIS game only. It's committed
  // here at launch (never stored while the host is still choosing) and wiped
  // when the room returns to the lobby. null/absent → automatic share-out.
  const roleAssign = normalizeRoleAssign(rawRoleAssign);
  const code = normalizeRoomCode(rawCode ?? "");
  if (!code || !playerId || !uploadId) {
    return NextResponse.json({ error: "Missing room, player, or video." }, { status: 400 });
  }

  const player = await db.roomPlayer.findUnique({ where: { id: playerId } });
  if (!player || player.roomCode !== code) {
    return NextResponse.json({ error: "You're not in this room." }, { status: 404 });
  }
  if (!player.isHost) {
    return NextResponse.json({ error: "Only the host can start the game." }, { status: 403 });
  }

  const upload = await db.videoUpload.findUnique({
    where: { id: uploadId },
    include: { segments: { select: { player: true, startMs: true, endMs: true } } },
  });
  if (!upload) return NextResponse.json({ error: "Video not found." }, { status: 404 });

  const playableSegs = upload.segments.filter((s) => s.endMs > s.startMs);
  if (playableSegs.length === 0) {
    return NextResponse.json({ error: "That video has no sectors to dub." }, { status: 409 });
  }

  // Freeze the roster order NOW so each player's seat (→ sector assignment) is
  // fixed for the whole game. The id tiebreaker keeps the order deterministic
  // even when two players joined in the same instant. This is the same order
  // roomView presents, so seat 1 is the host, then join order.
  const roster = await db.roomPlayer.findMany({
    where: { roomCode: code },
    orderBy: [{ isHost: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  // Party size no longer has to equal the video's character count: the sector →
  // seat assignment (lib/party-assign) adapts to any party size — fewer players
  // each voice several characters, more players share characters. We only need
  // at least one player (always true — the host is here).
  if (roster.length < 1) {
    return NextResponse.json({ error: "You need at least one player." }, { status: 409 });
  }

  // Reset per-player status, assign frozen seats, freeze the seat count, clear
  // any prior takes/result, then launch. Seat + seatCount are stored so a
  // mid-game leave can never shift who dubs which sector.
  await db.$transaction([
    db.roomTake.deleteMany({ where: { roomCode: code } }),
    // Clear any prior duel takes too (harmless no-op for a party — that table is
    // only written in duel mode). Keeps a relaunch from inheriting old takes.
    db.duelTake.deleteMany({ where: { roomCode: code } }),
    ...roster.map((p, i) =>
      db.roomPlayer.update({
        where: { id: p.id },
        // Also clear each player's own duel result URL from any previous game.
        data: { seat: i + 1, status: "playing", matchAvg: null, finalUrl: "" },
      }),
    ),
    db.room.update({
      where: { code },
      data: {
        videoUploadId: uploadId,
        finalUrl: "",
        status: "dubbing",
        seatCount: roster.length,
        // Commit the host's casting for this game (or clear to automatic).
        roleAssign: roleAssign ?? Prisma.DbNull,
        // Only override the room's mode when the caller specified one.
        ...(mode ? { mode } : {}),
      },
    }),
  ]);

  // Record this as a "run" of the video (one per launch), for the library's
  // "most played today" window. Fire-and-forget.
  void db.videoPlay.create({ data: { uploadId, mode: mode ?? "party" } }).catch(() => {});

  emitRoom(code); // everyone jumps into the studio on the chosen video
  return NextResponse.json({ room: await roomView(code) });
}
