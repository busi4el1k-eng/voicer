"use client";

import { usePathname, useRouter } from "next/navigation";

// App-wide "go back" button. Mirrors the AccountBar/settings button (top-right)
// on the opposite corner (top-left), centred to the same 1080px column so it
// lines up on every page. Hidden on the home screen, where there's nowhere back.
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === "/") return null;

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/");
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40">
      <div className="relative mx-auto max-w-[1080px]">
        <button
          type="button"
          onClick={goBack}
          aria-label="Go back"
          className="pointer-events-auto absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-[12px] text-ink shadow-[inset_0_0_0_2px_#fff2c2,0_3px_0_0_#c99a1e] transition-transform active:translate-y-[2px] active:shadow-[inset_0_0_0_2px_#fff2c2,0_1px_0_0_#c99a1e]"
          style={{ background: "linear-gradient(0deg, #ffcf3f 0%, #ffe27a 100%)" }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#1f0733"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M20 12H6" />
            <path d="M12 6l-6 6 6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
