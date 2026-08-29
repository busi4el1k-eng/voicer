import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import db from "@/lib/db";
import { GUEST_COOKIE } from "@/lib/guest-mode";

const COLORS = ["#ffb42e", "#FF3D8B", "#27E1A1", "#7C31BC", "#F97316", "#38BDF8"];

// Mirror the signed-in Clerk user into Postgres, creating the row on first sight.
// A production deployment would also run the user.created webhook, but lazy
// upsert keeps local dev working without a public webhook URL. Returns null for
// guests (no Clerk session).
export async function getOrCreateUser() {
  // A signed-in player who chose "Play as guest" is treated as a guest, so their
  // runs and uploads aren't attributed to their account. See guest-mode.ts.
  if ((await cookies()).get(GUEST_COOKIE)?.value === "1") return null;

  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  const existing = await db.user.findUnique({ where: { clerkId } });
  if (existing) return existing;

  // A Clerk API hiccup here must not crash the page — fall back to a default
  // name and let the profile fill in later.
  let displayName = "Player";
  try {
    const cu = await currentUser();
    displayName =
      cu?.firstName ||
      cu?.username ||
      cu?.emailAddresses?.[0]?.emailAddress?.split("@")[0] ||
      "Player";
  } catch {
    /* keep the default */
  }
  const avatarColor = COLORS[Math.abs(hash(clerkId)) % COLORS.length];

  return db.user.upsert({
    where: { clerkId },
    update: {},
    create: { clerkId, displayName, avatarColor },
  });
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
