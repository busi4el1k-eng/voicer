import { currentUser } from "@clerk/nextjs/server";

// Admin gate for the creator-management pages/APIs. An admin is any Clerk-
// signed-in user whose verified email is in the ADMIN_EMAILS allowlist
// (comma-separated env var). Falls back to the project owner so it works out of
// the box; set ADMIN_EMAILS in production to add/replace admins.
const DEFAULT_ADMINS = ["nichitabusuioc@gmail.com"];

export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  const list = (raw ? raw.split(",") : DEFAULT_ADMINS)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : DEFAULT_ADMINS;
}

// True when the current request is from a signed-in admin. Never throws — a
// Clerk hiccup or a guest simply isn't an admin.
export async function isAdmin(): Promise<boolean> {
  try {
    const cu = await currentUser();
    if (!cu) return false;
    const allow = adminEmails();
    return (cu.emailAddresses ?? []).some((e) =>
      allow.includes(e.emailAddress.toLowerCase()),
    );
  } catch {
    return false;
  }
}
