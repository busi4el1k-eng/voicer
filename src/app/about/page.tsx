import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "About Us · Cinema Dub",
  description:
    "What Cinema Dub is, who makes it, and why we built a game around dubbing short movie clips.",
};

// Static "About us" page — required for AdSense trust/transparency. On-brand
// layout that echoes the landing page (hero + mode cards). Public route.
const MODES = [
  {
    icon: "🎬",
    title: "Solo run",
    text: "Dub a whole clip at your own pace and get an instant match score against the original.",
  },
  {
    icon: "🎉",
    title: "Party mode",
    text: "Invite friends with a room code and split the characters between you for a group dub.",
  },
  {
    icon: "⚔️",
    title: "Duel mode",
    text: "Everyone dubs the same clip — the closest voice match to the original wins.",
  },
  {
    icon: "✂️",
    title: "Create & share",
    text: "Upload your own clips, cut them into lines, and publish them for the community to dub.",
  },
];

export default function AboutPage() {
  return (
    <main className="g-screen">
      {/* Hero — mirrors the landing page's logo lockup */}
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Logo className="h-[64px] w-[64px] shrink-0" />
        <Link href="/" className="g-logo">
          Cinema<em>Dub</em>
        </Link>
        <span className="rounded-full bg-mint/20 px-4 py-1 font-display text-[12px] font-black uppercase tracking-[0.08em] text-mint">
          Your voice, on the big screen
        </span>
      </div>

      <div className="w-full max-w-3xl pb-16 text-left text-cream/85">
        <h1 className="g-title mb-4 text-center">About Cinema Dub</h1>

        {/* Intro */}
        <div className="g-panel text-[15px] leading-relaxed">
          <p>
            <strong className="text-cream">Cinema Dub</strong> is a free online
            game that turns movie and cartoon clips into a stage for your voice.
            Pick a scene, listen to how it was originally delivered, then
            re-record the lines yourself. When you finish, the game stitches your
            voice back over the video so you can watch, share, and compare your
            take. Think karaoke — but for acting.
          </p>
        </div>

        {/* Modes as brand cards */}
        <h2 className="g-title mb-3 mt-8 text-center text-[18px]">Ways to play</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MODES.map((m) => (
            <div key={m.title} className="g-card" style={{ cursor: "default" }}>
              <div className="g-card-inner">
                <div className="g-ficon">{m.icon}</div>
                <section>
                  <h4>{m.title}</h4>
                  <p>{m.text}</p>
                </section>
              </div>
            </div>
          ))}
        </div>

        {/* Mission */}
        <div className="g-panel mt-8 flex items-start gap-4 text-[14px] leading-relaxed">
          <div className="grid h-12 w-12 flex-none place-items-center rounded-full bg-sun/20 text-[24px]">
            🎯
          </div>
          <div>
            <h2 className="mb-1 font-display text-[17px] font-black text-cream">
              Our mission
            </h2>
            <p>
              We want voice acting to feel as playful and social as karaoke. Most
              people never get to hear themselves as their favourite character —
              Cinema Dub removes every barrier: no downloads, no editing skills,
              no account required. Just press record and perform.
            </p>
          </div>
        </div>

        {/* Who we are — real operator details */}
        <div className="g-panel mt-4 flex items-start gap-4 text-[14px] leading-relaxed">
          <div className="grid h-12 w-12 flex-none place-items-center rounded-full bg-mint/20 text-[24px]">
            👋
          </div>
          <div>
            <h2 className="mb-1 font-display text-[17px] font-black text-cream">
              Who we are
            </h2>
            <p>
              Cinema Dub is an independent project built and maintained by{" "}
              <strong className="text-cream">Busuioc Nichita</strong>, based in{" "}
              <strong className="text-cream">Chișinău, Moldova</strong>. We are
              not affiliated with any film studio; uploaded clips belong to their
              respective owners and are used by our community for playful,
              non-commercial dubbing.
            </p>
          </div>
        </div>

        {/* CTA row */}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/dashboard" className="g-btn g-btn-start">
            Start dubbing →
          </Link>
          <Link href="/contact" className="g-btn g-btn-primary">
            Contact us
          </Link>
          <Link href="/privacy" className="g-btn g-btn-ghost">
            Privacy Policy
          </Link>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
