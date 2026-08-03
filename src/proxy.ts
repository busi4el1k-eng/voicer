import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { isClerkConfigured } from "@/lib/clerk";

// Public surface: guests play solo and online rooms without an account. Only
// video *creation* (upload/cut/edit) is members-only. Anything a guest touches
// while playing must be listed here, or auth.protect() redirects them to /login
// (e.g. a guest in a party being pulled into /party/studio by the host).
const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/signup(.*)",
  "/dashboard(.*)",
  "/library(.*)",
  "/play(.*)", // solo dubbing (guest)
  "/party(.*)", // online party lobby + studio (guest)
  "/api/clerk/webhook",
  "/api/library(.*)",
  "/api/videos(.*)",
  "/api/video(.*)", // per-video rating after a play
  "/api/room(.*)", // all party room actions (join/select/submit/render/…)
  "/api/solo(.*)", // solo lookup + video fetch
  "/api/creator/dub(.*)", // export the finished solo dub (no membership gate)
  "/api/download(.*)", // force-download a finished video
]);

// Stable guest identifier used to key online seats and rate limits. Set in
// middleware because Next 16 server components can't write cookies.
function ensureGuestCookie(request: NextRequest, response: NextResponse) {
  if (!request.cookies.has("cd_guest_id")) {
    response.cookies.set("cd_guest_id", crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 31536000,
      path: "/",
    });
  }
  return response;
}

const withClerk = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
    return;
  }
  return ensureGuestCookie(request as NextRequest, NextResponse.next());
});

// Without Clerk keys the whole app is the guest app — just manage the cookie.
export default function proxy(request: NextRequest, event: unknown) {
  if (isClerkConfigured()) {
    return (withClerk as (req: NextRequest, ev: unknown) => Response)(request, event);
  }
  return ensureGuestCookie(request, NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
