"use client";

import Link from "next/link";
import { useAuth, useUser } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/clerk";
import { useClerkFailed } from "@/components/ClerkResilientProvider";
import { setPlayAsGuest, clearPlayAsGuest } from "@/lib/guest-mode";

// The left "Play" column. Guests get the sign-in / create-account choices;
// a signed-in player gets a personalised "Play as <nickname>" plus a shortcut
// into their dashboard. Split from the page so the Clerk hooks only run when a
// ClerkProvider is actually mounted (mirrors AccountBar).

function GuestPlay() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      <Link href="/dashboard" className="g-btn g-btn-start w-full">
        Play as guest
      </Link>
      <Link href="/login" className="g-btn g-btn-ghost w-full">
        Sign in
      </Link>
      <Link href="/signup" className="g-btn g-btn-primary w-full">
        Create account
      </Link>
      <p className="mt-2 text-center text-[12px] leading-[1.5] text-cream/55">
        Guests can play right away. An account saves your scores and unlocks the dashboard.
      </p>
    </div>
  );
}

function SignedInPlay({ nickname }: { nickname: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      <Link href="/dashboard" onClick={clearPlayAsGuest} className="g-btn g-btn-start w-full">
        Play as {nickname}
      </Link>
      <Link href="/dashboard" onClick={setPlayAsGuest} className="g-btn g-btn-ghost w-full">
        Play as guest
      </Link>
      <p className="mt-2 text-center text-[12px] leading-[1.5] text-cream/55">
        Play as yourself to save your scores, or jump in as a guest.
      </p>
    </div>
  );
}

// Same precedence as get-user.ts's displayName so the greeting matches the DB.
function displayNameOf(user: ReturnType<typeof useUser>["user"]): string {
  return (
    user?.firstName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    "Player"
  );
}

function ClerkPlay() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  // While Clerk resolves, render the guest choices so the panel never flashes empty.
  if (!isLoaded || !isSignedIn) return <GuestPlay />;
  return <SignedInPlay nickname={displayNameOf(user)} />;
}

export function PlayPanel() {
  const clerkFailed = useClerkFailed();
  // Guest-only build (no Clerk) or Clerk failed to load: no session to read.
  if (!isClerkConfigured() || clerkFailed) return <GuestPlay />;
  return <ClerkPlay />;
}
