import "server-only";
import db from "@/lib/db";
import { randomRoomCode } from "@/lib/room-code";

// Generate a room code that isn't already an active room. Retry a few times on
// the (astronomically unlikely) collision before widening.
export async function generateRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomRoomCode();
    const existing = await db.room.findUnique({ where: { code } });
    if (!existing) return code;
  }
  return randomRoomCode() + Date.now().toString(36).toUpperCase().slice(-2);
}

export type PlayerView = {
  id: string;
  displayName: string;
  avatarColor: string;
  isHost: boolean;
  seat: number; // 1-based; host = 1, joiners in join order
  status: string; // 'playing' | 'finished'
};

export type RoomView = {
  code: string;
  status: string;
  videoUploadId: string | null;
  finalUrl: string;
  players: PlayerView[];
};

// The public shape of a room: its status, the chosen video / rendered result,
// plus the ordered player list (host first, then join order). Seat is derived
// from that ordering. Returns null if the room no longer exists.
export async function roomView(code: string): Promise<RoomView | null> {
  const room = await db.room.findUnique({
    where: { code },
    include: { players: { orderBy: [{ isHost: "desc" }, { createdAt: "asc" }] } },
  });
  if (!room) return null;
  return {
    code: room.code,
    status: room.status,
    videoUploadId: room.videoUploadId,
    finalUrl: room.finalUrl,
    players: room.players.map((p, i) => ({
      id: p.id,
      displayName: p.displayName,
      avatarColor: p.avatarColor,
      isHost: p.isHost,
      seat: i + 1,
      status: p.status,
    })),
  };
}
