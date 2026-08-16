import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";
import { emitRoom } from "@/lib/room-events";

export const runtime = "nodejs";

// Host-only: end the current game but KEEP the party together. Clears the
// video, result and everyone's takes, marks all players ready again, and drops
// the room back to the lobby (or straight to "playing" to pick a new video).
// Members follow via SSE — nobody has to re-create or re-join a room.
export async function POST(req: NextRequest) {
  const { code: rawCode, playerId, target } = (await req.json().catch(() => ({}))) as {
    code?: string;
    playerId?: string;
    target?: string;
  };
  const code = normalizeRoomCode(rawCode ?? "");
  if (!code || !playerId) {
    return NextResponse.json({ error: "Missing room or player." }, { status: 400 });
  }

  const player = await db.roomPlayer.findUnique({ where: { id: playerId } });
  if (!player || player.roomCode !== code) {
    return NextResponse.json({ error: "You're not in this room." }, { status: 404 });
  }

  const status = target === "playing" ? "playing" : "lobby";
  // Ending the game back to the lobby ("quit") is open to ANY player — anyone
  // can bail the whole party out of a game and everyone regroups in the lobby.
  // Jumping straight to picking a new video stays host-only.
  if (status === "playing" && !player.isHost) {
    return NextResponse.json({ error: "Only the host controls the room." }, { status: 403 });
  }
  await db.$transaction([
    db.roomTake.deleteMany({ where: { roomCode: code } }),
    // Clear frozen seats too — the next game re-assigns them in select, so a
    // party that changed size between rounds gets fresh, correct seating.
    db.roomPlayer.updateMany({ where: { roomCode: code }, data: { status: "playing", seat: 0 } }),
    db.room.update({ where: { code }, data: { status, videoUploadId: null, finalUrl: "" } }),
  ]);
  emitRoom(code);
  return NextResponse.json({ room: await roomView(code) });
}
