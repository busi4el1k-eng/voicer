import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";
import { emitRoom } from "@/lib/room-events";
import { chainOrder } from "@/lib/telephone";

export const runtime = "nodejs";

// Telephone Chain only: skip the turn that's stuck. The chain is strictly
// sequential, so an AFK or disconnected active player would otherwise freeze the
// whole party forever (a failure mode party/duel never have — there everyone
// plays in parallel). Skipping just advances the cursor WITHOUT recording a
// take; that sector keeps its original audio in the final render (muxDub only
// overlays sectors that actually have a take).
//
// Any player in the room may skip — the trust model already lets anyone end the
// whole game via reset ("Quit"). The client only reveals the button after a
// grace period (and immediately to the active player as "pass my turn"), so an
// accidental skip is unlikely.
export async function POST(req: NextRequest) {
  const { code: rawCode, playerId } = (await req.json().catch(() => ({}))) as {
    code?: string;
    playerId?: string;
  };
  const code = normalizeRoomCode(rawCode ?? "");
  if (!code || !playerId) {
    return NextResponse.json({ error: "Missing room or player." }, { status: 400 });
  }

  const room = await db.room.findUnique({
    where: { code },
    include: { players: { select: { id: true, seat: true } } },
  });
  if (!room) return NextResponse.json({ error: "Room closed." }, { status: 404 });
  if (room.mode !== "telephone") {
    return NextResponse.json({ error: "Skipping is only for Telephone." }, { status: 409 });
  }
  if (room.status !== "dubbing") {
    return NextResponse.json({ error: "The game isn't in progress." }, { status: 409 });
  }
  if (!room.players.some((p) => p.id === playerId)) {
    return NextResponse.json({ error: "You're not in this room." }, { status: 403 });
  }
  if (!room.videoUploadId) {
    return NextResponse.json({ error: "No video selected." }, { status: 409 });
  }

  const segments = await db.videoSegment.findMany({
    where: { uploadId: room.videoUploadId },
    select: { id: true, startMs: true, endMs: true },
  });
  const total = chainOrder(
    segments,
    room.seatCount > 0 ? room.seatCount : room.players.length,
  ).length;
  const round = room.round;
  if (round >= total) {
    return NextResponse.json({ error: "The chain is already complete." }, { status: 409 });
  }

  // Compare-and-swap so a skip can't race a real submit (or a second skip) into
  // double-advancing. The loser just no-ops — the cursor still moved exactly one.
  const advanced = await db.room.updateMany({
    where: { code, round, status: "dubbing" },
    data: { round: round + 1 },
  });
  if (advanced.count > 0 && round + 1 >= total) {
    await db.roomPlayer.updateMany({ where: { roomCode: code }, data: { status: "finished" } });
  }

  emitRoom(code); // the mic passes to the next player on every client
  return NextResponse.json({ room: await roomView(code) });
}
