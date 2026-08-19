// ─────────────────────────────────────────────────────────────────────────────
// Featured creators — shared types + the SEED profile for an empty table.
//
// A creator's videos are REAL uploads (VideoUpload rows tagged with creatorId),
// made through the same upload → editor → sectors flow as the creator studio and
// managed at /admin/creators. Playing one launches the dub game (solo/party),
// exactly like the Community library. This file only holds the TS shapes + the
// initial creator PROFILE seed (RayenIDK); videos are added by the admin.
// ─────────────────────────────────────────────────────────────────────────────

// One creator video = a public-ish VideoUpload with sectors.
export type CreatorWork = {
  id: string; // VideoUpload id (used for the solo run)
  title: string;
  shareId: string; // share code (used for party mode)
  sourceUrl: string; // for the thumbnail/preview
  durationMs: number;
  lines: number; // sector count (0 ⇒ not set up / not playable yet)
  players: number; // distinct sector players
};

// An extra social/external link on a creator (beyond Instagram).
export type CreatorLink = { platform: string; url: string };

// Known platforms for the link picker + their button label/icon. "other" is the
// catch-all for any custom link; it's always last.
export const LINK_PLATFORMS: { key: string; label: string; icon: string }[] = [
  { key: "youtube", label: "YouTube", icon: "▶️" },
  { key: "tiktok", label: "TikTok", icon: "🎵" },
  { key: "twitter", label: "X / Twitter", icon: "🐦" },
  { key: "twitch", label: "Twitch", icon: "🎮" },
  { key: "discord", label: "Discord", icon: "💬" },
  { key: "patreon", label: "Patreon", icon: "🧡" },
  { key: "website", label: "Website", icon: "🌐" },
  { key: "other", label: "Link", icon: "🔗" },
];
export const linkMeta = (platform: string) =>
  LINK_PLATFORMS.find((p) => p.key === platform) ?? LINK_PLATFORMS[LINK_PLATFORMS.length - 1];

export type Creator = {
  id: string;
  handle: string;
  name: string;
  tagline: string;
  bio: string;
  avatar: string; // image URL ("" ⇒ gradient + initial)
  color: string; // accent colour
  instagram: string; // primary Instagram link ("" ⇒ hidden)
  links: CreatorLink[]; // extra social/external links
  verified: boolean;
  works: CreatorWork[];
};

// A creator video is playable once it has sectors (set up in the editor).
export const isPlayable = (w: { lines: number }): boolean => w.lines > 0;

// ── Seed (profile only; inserted when the Creator table is empty) ────────────
export type CreatorSeed = Omit<Creator, "id" | "works">;

export const SEED_CREATORS: CreatorSeed[] = [
  {
    handle: "rayenidk",
    name: "RayenIDK",
    tagline: "Animator · commissions open",
    bio: "I dunno what I'm doin' ✍️ — animator. New clips drop here; play one and dub it your way.",
    avatar: "/creators/rayenidk/avatar.jpg",
    color: "#FF3D8B",
    instagram: "https://www.instagram.com/rayenidk/",
    links: [],
    verified: true,
  },
];
