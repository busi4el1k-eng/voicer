import "server-only";
import db from "@/lib/db";
import { randomShareCode } from "@/lib/share-id";

// Generate a share code that isn't already taken. Collisions are astronomically
// unlikely at this size, but we still retry a few times to be safe.
export async function generateShareId(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomShareCode();
    const existing = await db.videoUpload.findUnique({ where: { shareId: code } });
    if (!existing) return code;
  }
  // Extremely unlikely fallback: widen with a timestamp suffix.
  return randomShareCode() + Date.now().toString(36).toUpperCase().slice(-3);
}
