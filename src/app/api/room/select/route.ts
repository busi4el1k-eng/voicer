import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";
import { emitRoom } from "@/lib/room-events";

export const runtime = "nodejs";

// The host locks in the video for a party dub and launches the game: set the
// room's videoUploadId and flip status to "dubbing" so waiting members follow
// into the studio. Enforces the "party size must match the video's seats" rule.
export async function POST(req: NextRequest) {
  const { code: rawCode, playerId, uploadId } = (await req.json().catch(() => ({}))) as {
    code?: string;
    playerId?: string;
    uploadId?: string;
  };
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

  // Party size must exactly match the number of distinct seats the creator used.
  const seats = new Set(playableSegs.map((s) => s.player ?? 1)).size;
  const partySize = await db.roomPlayer.count({ where: { roomCode: code } });
  if (partySize !== seats) {
    return NextResponse.json(
      { error: `This video needs exactly ${seats} players; your party has ${partySize}.` },
      { status: 409 },
    );
  }

  // Reset per-player status and clear any prior takes/result, then launch.
  await db.$transaction([
    db.roomTake.deleteMany({ where: { roomCode: code } }),
    db.roomPlayer.updateMany({ where: { roomCode: code }, data: { status: "playing" } }),
    db.room.update({
      where: { code },
      data: { videoUploadId: uploadId, finalUrl: "", status: "dubbing" },
    }),
  ]);

  emitRoom(code); // everyone jumps into the studio on the chosen video
  return NextResponse.json({ room: await roomView(code) });
}
