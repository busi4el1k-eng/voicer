import db from "@/lib/db";
import { getOrCreateUser } from "@/lib/get-user";
import { isClerkConfigured } from "@/lib/clerk";
import { AccountBar } from "@/components/AccountBar";
import { AnnouncementBell } from "@/components/AnnouncementBell";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { T } from "@/components/LanguageProvider";
import { Lobby } from "@/components/Lobby";
import { StudioPanel, type Stat } from "@/components/StudioPanel";
import { TodayPodium } from "@/components/TodayPodium";
import { SocialCard } from "@/components/SocialCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // The DB can be momentarily unreachable (e.g. a Neon serverless cold start).
  // Guests must still get a usable dashboard, so every DB read degrades to a
  // sensible default instead of throwing a 500.
  let dbError = false;

  // getOrCreateUser() returns null for a signed-in player who chose "Play as
  // guest" (cookie), so the guest experience below just works.
  let user = null;
  try {
    user = isClerkConfigured() ? await getOrCreateUser() : null;
  } catch {
    dbError = true;
  }
  const name = user?.displayName || "Guest";
  const isGuest = !user;
  const avatarColor = user?.avatarColor || "#3f8fc8";
  const initial = name.charAt(0).toUpperCase();

  // Real stats from the DB for the signed-in user. Guests have none yet → "—".
  // Labels are i18n keys, translated client-side in StudioPanel. We only surface
  // the Rating stat now (runs / scenes played / best scene were dropped).
  let stats: Stat[] = [
    { label: "stat.rating", value: "—" },
    { label: "stat.duelWins", value: "—" },
  ];
  if (user) {
    try {
      const [rating, duelWins] = await Promise.all([
        db.playerRating.aggregate({
          where: { ratedUserId: user.id },
          _avg: { stars: true },
          _count: true,
        }),
        db.duelWin.count({ where: { userId: user.id } }),
      ]);
      // Average star rating other players gave this user across finished parties,
      // shown as e.g. "4.3 ★ (7)". "—" until they've been rated at least once.
      const avgStars = rating._avg.stars;
      const ratingLabel =
        rating._count > 0 && avgStars != null
          ? `${(Math.round(avgStars * 10) / 10).toFixed(1)} ★ (${rating._count})`
          : "—";
      // Duel wins shown as a row of crowns (👑 ×N), or "—" before the first win.
      const winsLabel = duelWins > 0 ? `${"👑".repeat(Math.min(duelWins, 5))} ${duelWins}` : "—";
      stats = [
        { label: "stat.rating", value: ratingLabel },
        { label: "stat.duelWins", value: winsLabel },
      ];
    } catch {
      dbError = true;
    }
  }

  return (
    <main className="g-screen">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <AnnouncementBell />
        <LanguageSwitcher />
        <AccountBar />
      </div>

      <div className="flex h-[92px] items-center">
        <h1 className="g-logo">
          DubThat<em>Movie</em>
        </h1>
      </div>

      {dbError && (
        <div className="mb-3 rounded-[10px] bg-magenta/20 px-4 py-2 text-center text-[12px] text-cream">
          <T k="dash.dbError" />
        </div>
      )}

      <div className="g-center">
        {/* LEFT — profile + stats */}
        <div className="g-left">
          <h2 className="g-title">
            <T k="dash.studioTitle" />
          </h2>
          <StudioPanel
            name={name}
            isGuest={isGuest}
            avatarColor={avatarColor}
            initial={initial}
            stats={stats}
          />
        </div>

        {/* RIGHT — mode lobby */}
        <Lobby isGuest={isGuest} playerName={name} avatarColor={avatarColor} />
      </div>

      {/* BELOW — today's top-3 dubbed clips (2/3) beside the socials (1/3). */}
      <div className="g-podium-row mt-4 flex w-full items-stretch gap-4">
        <TodayPodium />
        <SocialCard />
      </div>
    </main>
  );
}
