import db from "@/lib/db";
import { getOrCreateUser } from "@/lib/get-user";
import { isClerkConfigured } from "@/lib/clerk";
import { AccountBar } from "@/components/AccountBar";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { T } from "@/components/LanguageProvider";
import { Lobby } from "@/components/Lobby";
import { StudioPanel, type Stat } from "@/components/StudioPanel";

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
  const avatarColor = user?.avatarColor || "#6F48FF";
  const initial = name.charAt(0).toUpperCase();

  // Real stats from the DB for the signed-in user. Guests have none yet → zeros.
  // Labels are i18n keys, translated client-side in StudioPanel.
  let stats: Stat[] = [
    { label: "stat.runs", value: 0 },
    { label: "stat.scenes", value: 0 },
    { label: "stat.rating", value: "—" },
    { label: "stat.best", value: 0 },
  ];
  if (user) {
    try {
      const [runCount, agg, best, rating] = await Promise.all([
        db.run.count({ where: { userId: user.id } }),
        db.take.aggregate({ where: { userId: user.id }, _count: true }),
        db.take.aggregate({ where: { userId: user.id }, _max: { judgeScore: true } }),
        db.playerRating.aggregate({ where: { ratedUserId: user.id }, _avg: { stars: true }, _count: true }),
      ]);
      // Average star rating other players gave this user across finished parties,
      // shown as e.g. "4.3 ★ (7)". "—" until they've been rated at least once.
      const avgStars = rating._avg.stars;
      const ratingLabel =
        rating._count > 0 && avgStars != null
          ? `${(Math.round(avgStars * 10) / 10).toFixed(1)} ★ (${rating._count})`
          : "—";
      stats = [
        { label: "stat.runs", value: runCount },
        { label: "stat.scenes", value: agg._count },
        { label: "stat.rating", value: ratingLabel },
        { label: "stat.best", value: best._max.judgeScore ?? 0 },
      ];
    } catch {
      dbError = true;
    }
  }

  return (
    <main className="g-screen">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <LanguageSwitcher />
        <AccountBar />
      </div>

      <div className="flex h-[92px] items-center">
        <h1 className="g-logo">
          Cinema<em>Dub</em>
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
    </main>
  );
}
