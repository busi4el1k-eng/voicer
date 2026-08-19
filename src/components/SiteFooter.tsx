import Link from "next/link";

// Small site-wide footer with the legal/trust links AdSense expects to be easy
// to find (About, Contacts, Privacy). Kept plain text in English (app default).
// Rendered on the public landing page and the static info pages.
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-auto w-full border-t border-white/10 pt-4 pb-6 text-center text-[12px] text-cream/50">
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <Link href="/about" className="hover:text-cream/80">
          About Us
        </Link>
        <span className="text-cream/20">·</span>
        <Link href="/contact" className="hover:text-cream/80">
          Contacts
        </Link>
        <span className="text-cream/20">·</span>
        <Link href="/privacy" className="hover:text-cream/80">
          Privacy Policy
        </Link>
      </nav>
      <p className="mt-3">© {year} Cinema Dub · dubthatmovie.com</p>
    </footer>
  );
}
