import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";

export const runtime = "nodejs";

// Leave a room. A player is identified by the secret playerId (their RoomPlayer
// row id) handed out on create/join. When the host leaves, the whole room is
// torn down; when the last player leaves, the empty room is removed too.
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
    // Already gone / room closed — treat as success so the client can reset.
    return NextResponse.json({ room: null });
  }

  if (player.isHost) {
    // Host closes the room for everyone (cascade deletes the player rows).
    await db.room.delete({ where: { code } }).catch(() => {});
    return NextResponse.json({ room: null });
  }

  await db.roomPlayer.delete({ where: { id: playerId } }).catch(() => {});
  const remaining = await db.roomPlayer.count({ where: { roomCode: code } });
  if (remaining === 0) {
    await db.room.delete({ where: { code } }).catch(() => {});
    return NextResponse.json({ room: null });
  }

  return NextResponse.json({ room: await roomView(code) });
}
