import { T } from "@/components/LanguageProvider";

// Social window — sits at 1/3 width next to the "Clips of Today" podium, same
// height. Two image buttons linking out to Instagram and TikTok; each fills half
// the window height (object-cover) so they always fit whatever the window height.

const INSTAGRAM_URL = "https://www.instagram.com/dubthatmovies";
const TIKTOK_URL = "https://www.tiktok.com/@dubthatmovie_off";

export function SocialCard() {
  return (
    <aside className="g-podium min-w-0 flex-[1] self-stretch">
      <h2 className="g-title">
        <T k="social.title" />
      </h2>

      <div className="g-social-panel g-panel flex min-h-[200px] flex-1 flex-col gap-3">
        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Instagram"
          className="block min-h-0 flex-1 overflow-hidden rounded-[12px] transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <img src="/social/instagram.png" alt="Instagram" className="h-full w-full object-cover" />
        </a>
        <a
          href={TIKTOK_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="TikTok"
          className="block min-h-0 flex-1 overflow-hidden rounded-[12px] transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <img src="/social/tiktok.png" alt="TikTok" className="h-full w-full object-cover" />
        </a>
      </div>
    </aside>
  );
}
