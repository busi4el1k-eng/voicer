import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { getOrCreateUser } from "@/lib/get-user";

export const runtime = "nodejs";

// The signed-in player's internal id (used to identify them in analytics) — or
// null for a guest. Public + guest-safe: never redirects, just reports identity.
export async function GET() {
  try {
    const user = await getOrCreateUser();
    return NextResponse.json({ id: user?.id ?? null });
  } catch {
    return NextResponse.json({ id: null });
  }
}

// Update the signed-in player's profile. For now just the display name (shown on
// the dashboard and as "Play as <name>").
export async function PATCH(req: NextRequest) {
  const user = await getOrCreateUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { displayName } = (await req.json().catch(() => ({}))) as { displayName?: string };
  const name = (displayName ?? "").trim().slice(0, 40);
  if (!name) return NextResponse.json({ error: "Username can't be empty." }, { status: 400 });

  const updated = await db.user.update({
    where: { id: user.id },
    data: { displayName: name },
  });
  return NextResponse.json({ user: { id: updated.id, displayName: updated.displayName } });
}
