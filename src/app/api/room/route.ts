import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { getOrCreateUser } from "@/lib/get-user";
import { generateRoomCode, roomView } from "@/lib/room.server";

export const runtime = "nodejs";

// Create a new room and seat the caller as host. Works for guests too — the
// display name / colour come from the dashboard, userId is attached only when
// signed in (so the host's account can be credited later).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    displayName?: string;
    avatarColor?: string;
  };
  const displayName = (body.displayName ?? "Player").trim().slice(0, 40) || "Player";
  const avatarColor = (body.avatarColor ?? "#6F48FF").slice(0, 9);

  let userId: string | null = null;
  try {
    userId = (await getOrCreateUser())?.id ?? null;
  } catch {
    // DB hiccup fetching the user must not block guest room creation.
  }

  const code = await generateRoomCode();
  await db.room.create({
    data: {
      code,
      hostId: userId,
      players: {
        create: { displayName, avatarColor, userId, isHost: true },
      },
    },
  });

  const view = await roomView(code);
  const me = view?.players.find((p) => p.isHost);
  return NextResponse.json({ room: view, playerId: me?.id });
}
