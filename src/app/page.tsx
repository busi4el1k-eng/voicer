import { AccountBar } from "@/components/AccountBar";
import { PlayPanel } from "@/components/PlayPanel";
import { Logo } from "@/components/Logo";
import { T } from "@/components/LanguageProvider";

const STEPS = [
  { icon: "🎧", titleKey: "home.step.listen.t", textKey: "home.step.listen.d" },
  { icon: "🎤", titleKey: "home.step.perform.t", textKey: "home.step.perform.d" },
  { icon: "🤖", titleKey: "home.step.judged.t", textKey: "home.step.judged.d" },
  { icon: "🏆", titleKey: "home.step.win.t", textKey: "home.step.win.d" },
];

export default function Landing() {
  return (
    <main className="g-screen">
      <div className="absolute right-4 top-4 z-10">
        <AccountBar />
      </div>

      <div className="flex h-[104px] items-center justify-center gap-3">
        <Logo className="h-[64px] w-[64px] shrink-0" />
        <h1 className="g-logo">
          Cinema<em>Dub</em>
        </h1>
      </div>

      <div className="g-center">
        {/* LEFT — choose how to play */}
        <div className="g-left g-panel">
          <h2 className="g-title"><T k="home.play" /></h2>
          <PlayPanel />
        </div>

        {/* RIGHT — how to play */}
        <div className="g-right g-panel">
          <h2 className="g-title"><T k="home.howToPlay" /></h2>
          <div className="grid flex-1 grid-cols-1 content-start gap-3 sm:grid-cols-2">
            {STEPS.map((s) => (
              <div key={s.titleKey} className="g-card" style={{ cursor: "default" }}>
                <div className="g-card-inner">
                  <div className="g-ficon">{s.icon}</div>
                  <section>
                    <h4><T k={s.titleKey} /></h4>
                    <p><T k={s.textKey} /></p>
                  </section>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
