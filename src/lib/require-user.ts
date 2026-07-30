import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import db from "@/lib/db";

type UserContext = {
  clerkId: string;
  userId: string;
  user: { id: string; displayName: string; avatarColor: string };
};

// Call at the start of routes that require an account (dashboard, saved stats).
// A guest (no Clerk session) gets 401. Same shape as the reference's requireUser.
export async function requireUser(): Promise<UserContext | NextResponse> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { clerkId },
    select: { id: true, displayName: true, avatarColor: true },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return { clerkId, userId: user.id, user };
}
