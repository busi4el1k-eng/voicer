import { NextResponse, type NextRequest } from "next/server";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";

export const runtime = "nodejs";

// Poll a room's current state (players + status). Returns 404 once the room is
// gone (e.g. everyone left), which the client treats as "room closed".
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const code = normalizeRoomCode((await ctx.params).code);
  const view = await roomView(code);
  if (!view) return NextResponse.json({ error: "Room closed." }, { status: 404 });
  return NextResponse.json({ room: view });
}
