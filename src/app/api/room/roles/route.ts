import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView, normalizeRoleAssign } from "@/lib/room.server";
import { emitRoom } from "@/lib/room-events";

export const runtime = "nodejs";

// Host-only: save the manual character casting for the room, or clear it (pass
// roleAssign: null) to fall back to the automatic share-out. Only allowed while
// the room is still being set up (lobby / picking a video) — once the game is
// running the seat assignment is frozen. The stored shape is
// { [playerId]: number[] } (player → the character roles they voice); the
// studio and submit route read it back to decide who dubs what.
export async function POST(req: NextRequest) {
  const { code: rawCode, playerId, roleAssign } = (await req.json().catch(() => ({}))) as {
    code?: string;
    playerId?: string;
    roleAssign?: unknown;
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
    return NextResponse.json({ error: "Only the host can cast roles." }, { status: 403 });
  }

  const room = await db.room.findUnique({ where: { code }, select: { status: true } });
  if (!room) return NextResponse.json({ error: "Room closed." }, { status: 404 });
  if (room.status !== "lobby" && room.status !== "playing") {
    return NextResponse.json({ error: "The game already started." }, { status: 409 });
  }

  // Normalise to a clean { [playerId]: number[] } (or null); reject junk quietly
  // by storing null rather than a malformed object. Prisma needs Prisma.DbNull
  // (not JS null) to write SQL NULL to a Json? column.
  const clean = roleAssign == null ? null : normalizeRoleAssign(roleAssign);
  await db.room.update({
    where: { code },
    data: { roleAssign: clean ?? Prisma.DbNull },
  });

  emitRoom(code); // guests see the updated casting live
  return NextResponse.json({ room: await roomView(code) });
}
