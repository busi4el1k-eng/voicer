// Fixed, non-scrolling stage backdrop: the purple→magenta gradient plus a slow
// loop of translucent black movie emojis drifting up along the main diagonal
// (bottom-left → top-right). Rendered once in the root layout, behind all
// content, so it always covers the full viewport and never scrolls with the
// page — which also fixes the white gap that used to show below the body.
//
// The floaters use a fixed, deterministic config (no Math.random) so server and
// client markup match and hydration stays clean.

const FLOATERS = [
  { e: "🎬", left: "6%", size: 46, dur: 26, delay: 13, drift: "14vw", rot: 18 },
  { e: "🎤", left: "18%", size: 34, dur: 32, delay: 6, drift: "10vw", rot: -12 },
  { e: "🎧", left: "30%", size: 52, dur: 22, delay: 3, drift: "18vw", rot: 10 },
  { e: "🍿", left: "42%", size: 38, dur: 30, delay: 9, drift: "12vw", rot: -16 },
  { e: "🎥", left: "54%", size: 44, dur: 24, delay: 1, drift: "16vw", rot: 14 },
  { e: "🏆", left: "66%", size: 36, dur: 34, delay: 12, drift: "9vw", rot: -8 },
  { e: "🎞️", left: "78%", size: 50, dur: 28, delay: 5, drift: "13vw", rot: 20 },
  { e: "⭐", left: "88%", size: 30, dur: 36, delay: 8, drift: "8vw", rot: -14 },
  { e: "🎙️", left: "12%", size: 40, dur: 29, delay: 14, drift: "15vw", rot: 12 },
  { e: "📽️", left: "48%", size: 42, dur: 27, delay: 17, drift: "11vw", rot: -18 },
  { e: "🎫", left: "72%", size: 34, dur: 33, delay: 11, drift: "14vw", rot: 16 },
  { e: "🌟", left: "36%", size: 32, dur: 31, delay: 20, drift: "10vw", rot: -10 },
  { e: "🎬", left: "24%", size: 30, dur: 35, delay: 22, drift: "9vw", rot: -20 },
  { e: "🍿", left: "84%", size: 44, dur: 23, delay: 4, drift: "17vw", rot: 12 },
  { e: "🎧", left: "60%", size: 36, dur: 30, delay: 15, drift: "12vw", rot: -14 },
  { e: "🎤", left: "3%", size: 48, dur: 25, delay: 10, drift: "15vw", rot: 16 },
  { e: "🎥", left: "94%", size: 32, dur: 33, delay: 2, drift: "8vw", rot: -12 },
  { e: "🎙️", left: "70%", size: 46, dur: 21, delay: 18, drift: "18vw", rot: 22 },
  { e: "⭐", left: "15%", size: 28, dur: 38, delay: 7, drift: "10vw", rot: -8 },
  { e: "🎞️", left: "52%", size: 34, dur: 29, delay: 24, drift: "13vw", rot: 14 },
  { e: "🎫", left: "40%", size: 40, dur: 26, delay: 13, drift: "11vw", rot: -18 },
  { e: "🌟", left: "80%", size: 30, dur: 34, delay: 19, drift: "9vw", rot: 10 },
  { e: "🎬", left: "64%", size: 38, dur: 31, delay: 26, drift: "14vw", rot: -16 },
  { e: "🏆", left: "28%", size: 42, dur: 24, delay: 16, drift: "16vw", rot: 18 },
  { e: "📽️", left: "9%", size: 34, dur: 37, delay: 28, drift: "10vw", rot: -10 },
  { e: "🍿", left: "56%", size: 30, dur: 32, delay: 21, drift: "12vw", rot: 20 },
];

export function AnimatedBackground() {
  return (
    <div aria-hidden className="g-bg">
      {FLOATERS.map((f, i) => (
        <span
          key={i}
          className="g-bg-float"
          style={
            {
              left: f.left,
              fontSize: `${f.size}px`,
              animationDuration: `${f.dur}s`,
              // Negative delay: each floater starts already partway through its
              // loop, so the screen is full of drifting emojis on first paint
              // instead of streaming in from the bottom.
              animationDelay: `-${f.delay}s`,
              "--g-float-x": f.drift,
              "--g-float-rot": `${f.rot}deg`,
            } as React.CSSProperties
          }
        >
          {f.e}
        </span>
      ))}
    </div>
  );
}
