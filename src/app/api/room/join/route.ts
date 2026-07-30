import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { getOrCreateUser } from "@/lib/get-user";
import { normalizeRoomCode, MAX_PLAYERS } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";

export const runtime = "nodejs";

// Join an existing room by its invite code. Rejects if the room is missing,
// already in play, or full (4 players).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    displayName?: string;
    avatarColor?: string;
  };
  const code = normalizeRoomCode(body.code ?? "");
  if (!code) return NextResponse.json({ error: "Enter a room code." }, { status: 400 });

  const displayName = (body.displayName ?? "Player").trim().slice(0, 40) || "Player";
  const avatarColor = (body.avatarColor ?? "#6F48FF").slice(0, 9);

  const room = await db.room.findUnique({
    where: { code },
    include: { _count: { select: { players: true } } },
  });
  if (!room) return NextResponse.json({ error: "No room found for that code." }, { status: 404 });
  if (room.status !== "lobby") {
    return NextResponse.json({ error: "That room already started." }, { status: 409 });
  }
  if (room._count.players >= MAX_PLAYERS) {
    return NextResponse.json({ error: "That room is full." }, { status: 409 });
  }

  let userId: string | null = null;
  try {
    userId = (await getOrCreateUser())?.id ?? null;
  } catch {
    /* guests still join */
  }

  const player = await db.roomPlayer.create({
    data: { roomCode: code, displayName, avatarColor, userId, isHost: false },
  });

  const view = await roomView(code);
  return NextResponse.json({ room: view, playerId: player.id });
}
