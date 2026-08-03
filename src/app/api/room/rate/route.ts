import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { normalizeRoomCode } from "@/lib/room-code";

export const runtime = "nodejs";

// Player ratings for a finished party dub: each player scores every OTHER
// player 0–5 stars. Stored durably in PlayerRating (linked to the rated user's
// account when they have one) so the dashboard can aggregate a member's rating.

// GET /api/room/rate?code=XXXX&playerId=... → the scores this player already
// gave in this room, so the UI can restore its selection across reloads.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = normalizeRoomCode(url.searchParams.get("code") ?? "");
  const playerId = url.searchParams.get("playerId") ?? "";
  if (!code || !playerId) {
    return NextResponse.json({ error: "Missing room or player." }, { status: 400 });
  }

  const rows = await db.playerRating.findMany({
    where: { roomCode: code, raterPlayerId: playerId },
    select: { ratedPlayerId: true, stars: true },
  });
  const ratings: Record<string, number> = {};
  for (const r of rows) ratings[r.ratedPlayerId] = r.stars;
  return NextResponse.json({ ratings });
}

// POST /api/room/rate  { code, playerId, ratings: { [ratedPlayerId]: stars } }
// Upserts one row per (rater → ratee) pair. Only rows for real co-players are
// accepted; you can't rate yourself, and stars are clamped to 0–5.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    playerId?: string;
    ratings?: Record<string, unknown>;
  };
  const code = normalizeRoomCode(body.code ?? "");
  const playerId = body.playerId ?? "";
  if (!code || !playerId) {
    return NextResponse.json({ error: "Missing room or player." }, { status: 400 });
  }
  if (!body.ratings || typeof body.ratings !== "object") {
    return NextResponse.json({ error: "No ratings provided." }, { status: 400 });
  }

  const room = await db.room.findUnique({
    where: { code },
    include: { players: { select: { id: true, userId: true } } },
  });
  if (!room) return NextResponse.json({ error: "Room closed." }, { status: 404 });

  const rater = room.players.find((p) => p.id === playerId);
  if (!rater) return NextResponse.json({ error: "You're not in this room." }, { status: 403 });

  const byId = new Map(room.players.map((p) => [p.id, p]));

  let saved = 0;
  for (const [ratedPlayerId, raw] of Object.entries(body.ratings)) {
    if (ratedPlayerId === playerId) continue; // no rating yourself
    const ratee = byId.get(ratedPlayerId);
    if (!ratee) continue; // not a co-player in this room
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const stars = Math.max(0, Math.min(5, Math.round(n)));

    await db.playerRating.upsert({
      where: {
        roomCode_raterPlayerId_ratedPlayerId: { roomCode: code, raterPlayerId: playerId, ratedPlayerId },
      },
      update: { stars, ratedUserId: ratee.userId },
      create: { roomCode: code, raterPlayerId: playerId, ratedPlayerId, ratedUserId: ratee.userId, stars },
    });
    saved++;
  }

  return NextResponse.json({ ok: true, saved });
}
