"use client";

import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";

// App-wide "go back" button. Mirrors the AccountBar/settings button (top-right)
// on the opposite corner (top-left), centred to the same 1080px column so it
// lines up on every page. Hidden on the home screen, where there's nowhere back.
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  if (pathname === "/") return null;

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/");
  };

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-40"
      // Mirror the body's symmetric ad-rail gutters so this fixed bar's centred
      // 1080 column sits in the exact same box as the page content — otherwise
      // the button drifts into the left gutter on narrower desktops, where the
      // content column is squeezed below 1080. See --ad-rail in globals.css.
      // Also mirror the content's --g-zoom so this button matches the size of the
      // top-right controls (which live inside the zoomed .g-screen).
      style={{
        zoom: "var(--g-zoom, 1)" as React.CSSProperties["zoom"],
        paddingLeft: "var(--ad-rail, 0px)",
        paddingRight: "var(--ad-rail, 0px)",
      }}
    >
      <div className="relative mx-auto max-w-[1080px]">
        <button
          type="button"
          onClick={goBack}
          aria-label={t("common.goBack")}
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
