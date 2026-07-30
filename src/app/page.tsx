import { AccountBar } from "@/components/AccountBar";
import { PlayPanel } from "@/components/PlayPanel";

const STEPS = [
  { icon: "🎧", title: "Listen", text: "Hear the scene's original line — once." },
  { icon: "🎤", title: "Perform", text: "Say it back over the muted replay. Match the delivery." },
  { icon: "🤖", title: "Get judged", text: "The robot judge scores your pitch, rhythm and words." },
  { icon: "🏆", title: "Win the run", text: "Six scenes. The highest total takes the crown." },
];

export default function Landing() {
  return (
    <main className="g-screen">
      <div className="absolute right-4 top-4 z-10">
        <AccountBar />
      </div>

      <div className="flex h-[104px] items-center">
        <h1 className="g-logo">
          Cinema<em>Dub</em>
        </h1>
      </div>

      <div className="g-center">
        {/* LEFT — choose how to play */}
        <div className="g-left g-panel">
          <h2 className="g-title">Play</h2>
          <PlayPanel />
        </div>

        {/* RIGHT — how to play */}
        <div className="g-right g-panel">
          <h2 className="g-title">How to play</h2>
          <div className="grid flex-1 grid-cols-1 content-start gap-3 sm:grid-cols-2">
            {STEPS.map((s) => (
              <div key={s.title} className="g-card" style={{ cursor: "default" }}>
                <div className="g-card-inner">
                  <div className="g-ficon">{s.icon}</div>
                  <section>
                    <h4>{s.title}</h4>
                    <p>{s.text}</p>
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
