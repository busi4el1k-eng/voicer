import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getOrCreateUser } from "@/lib/get-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The signed-in player's real performance history: every finished party game
// they took part in, newest first, with the scene's title, when it happened,
// how many played, and the star rating they earned that game. Guests get an
// empty list. Solo runs aren't persisted yet, so this is party games only.
export async function GET() {
  const user = await getOrCreateUser().catch(() => null);
  if (!user) return NextResponse.json({ entries: [] });

  // Rooms this user played in that have finished, newest first.
  const players = await db.roomPlayer.findMany({
    where: { userId: user.id, room: { status: "finished" } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      roomCode: true,
      createdAt: true,
      room: {
        select: {
          videoUploadId: true,
          createdAt: true,
          _count: { select: { players: true } },
        },
      },
    },
  });

  const vidIds = [...new Set(players.map((p) => p.room?.videoUploadId).filter(Boolean))] as string[];
  const roomCodes = players.map((p) => p.roomCode);

  const [vids, ratings] = await Promise.all([
    vidIds.length
      ? db.videoUpload.findMany({ where: { id: { in: vidIds } }, select: { id: true, title: true } })
      : Promise.resolve([] as { id: string; title: string }[]),
    roomCodes.length
      ? db.playerRating.groupBy({
          by: ["roomCode"],
          where: { ratedUserId: user.id, roomCode: { in: roomCodes } },
          _avg: { stars: true },
        })
      : Promise.resolve([] as { roomCode: string; _avg: { stars: number | null } }[]),
  ]);

  const titleById = new Map(vids.map((v) => [v.id, v.title]));
  const starsByRoom = new Map(ratings.map((r) => [r.roomCode, r._avg.stars]));

  const entries = players.map((p) => {
    const avg = starsByRoom.get(p.roomCode);
    return {
      id: p.id,
      when: (p.room?.createdAt ?? p.createdAt).toISOString(),
      mode: "Party" as const,
      title:
        (p.room?.videoUploadId ? titleById.get(p.room.videoUploadId) : null) || "Untitled scene",
      players: p.room?._count.players ?? undefined,
      stars: avg != null ? Math.round(avg) : null,
    };
  });

  return NextResponse.json({ entries });
}
