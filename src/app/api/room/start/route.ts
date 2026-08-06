import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { normalizeRoomCode, MIN_PLAYERS } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";
import { emitRoom } from "@/lib/room-events";

export const runtime = "nodejs";

// The host starts the party for everyone: flip the room to "playing" so the
// other members (who are polling and waiting) follow into the game. Only the
// host may do this, and only once the party is big enough.
export async function POST(req: NextRequest) {
  const { code: rawCode, playerId } = (await req.json().catch(() => ({}))) as {
    code?: string;
    playerId?: string;
  };
  const code = normalizeRoomCode(rawCode ?? "");
  if (!code || !playerId) {
    return NextResponse.json({ error: "Missing room or player." }, { status: 400 });
  }

  const player = await db.roomPlayer.findUnique({ where: { id: playerId } });
  if (!player || player.roomCode !== code) {
    return NextResponse.json({ error: "You're not in this room." }, { status: 404 });
  }
  if (!player.isHost) {
    return NextResponse.json({ error: "Only the host can start the party." }, { status: 403 });
  }

  const count = await db.roomPlayer.count({ where: { roomCode: code } });
  if (count < MIN_PLAYERS) {
    return NextResponse.json(
      { error: `Party needs at least ${MIN_PLAYERS} players.` },
      { status: 409 },
    );
  }

  await db.room.update({ where: { code }, data: { status: "playing" } });
  emitRoom(code); // waiting members follow the host into the game
  return NextResponse.json({ room: await roomView(code) });
}
