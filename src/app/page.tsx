import { AccountBar } from "@/components/AccountBar";
import { PlayPanel } from "@/components/PlayPanel";
import { T } from "@/components/LanguageProvider";
import { HowToPlayCarousel } from "@/components/HowToPlayCarousel";
import { SiteFooter } from "@/components/SiteFooter";

export default function Landing() {
  return (
    <main className="g-screen landing-fit">
      <div className="absolute right-4 top-4 z-10">
        <AccountBar />
      </div>

      {/* Centre the logo + panels vertically in the viewport; the footer stays
          pinned at the bottom (its mt-auto used to push everything to the top). */}
      <div className="flex w-full min-h-0 flex-1 flex-col items-center justify-center gap-2 py-3">
        <div className="flex h-[92px] shrink-0 items-center justify-center gap-3">
          <h1 className="g-logo">
            DubThat<em>Movie</em>
          </h1>
        </div>

        <div className="g-center">
          {/* LEFT — choose how to play */}
          <div className="g-left g-panel">
            <h2 className="g-title"><T k="home.play" /></h2>
            <PlayPanel />
          </div>

          {/* RIGHT — how to play, as one auto-rotating, swipeable slide */}
          <div className="g-right g-panel">
            <HowToPlayCarousel />
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
