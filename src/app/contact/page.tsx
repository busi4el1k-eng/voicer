import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Contacts · Cinema Dub",
  description:
    "How to reach the Cinema Dub team — support, feedback, business enquiries, and content/takedown requests.",
};

// Static "Contacts" page — required for AdSense trust/transparency. On-brand
// layout with contact-method cards. Public route (see proxy.ts).
const EMAIL = "busi4el1k@gmail.com";

export default function ContactPage() {
  return (
    <main className="g-screen">
      {/* Hero */}
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Logo className="h-[64px] w-[64px] shrink-0" />
        <Link href="/" className="g-logo">
          Cinema<em>Dub</em>
        </Link>
        <span className="rounded-full bg-mint/20 px-4 py-1 font-display text-[12px] font-black uppercase tracking-[0.08em] text-mint">
          We usually reply within 2–3 days
        </span>
      </div>

      <div className="w-full max-w-3xl pb-16 text-left text-cream/85">
        <h1 className="g-title mb-4 text-center">Get in touch</h1>

        <p className="mx-auto mb-8 max-w-xl text-center text-[15px] leading-relaxed text-cream/70">
          Got a question, a bug, an idea, or a partnership in mind? We&rsquo;d
          love to hear from you — Cinema Dub is a small, independent project and
          real people read every message.
        </p>

        {/* Contact-method cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Email */}
          <div className="g-panel flex flex-col items-start gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-mint/20 text-[24px]">
              ✉️
            </div>
            <h2 className="font-display text-[17px] font-black text-cream">Email us</h2>
            <p className="text-[14px] leading-relaxed text-cream/75">
              The fastest way to reach us — support, feedback, or advertising and
              partnership enquiries.
            </p>
            <a href={`mailto:${EMAIL}`} className="g-btn g-btn-primary mt-auto w-full">
              {EMAIL}
            </a>
          </div>

          {/* Takedown */}
          <div className="g-panel flex flex-col items-start gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-sun/20 text-[24px]">
              🛡️
            </div>
            <h2 className="font-display text-[17px] font-black text-cream">
              Content &amp; takedowns
            </h2>
            <p className="text-[14px] leading-relaxed text-cream/75">
              If a clip uses your work and you&rsquo;d like it removed, email us
              with a link and proof of ownership. We act on valid requests
              promptly.
            </p>
            <a
              href={`mailto:${EMAIL}?subject=Takedown%20request`}
              className="g-btn g-btn-ghost mt-auto w-full"
            >
              Send a request
            </a>
          </div>
        </div>

        {/* Operator info */}
        <div className="g-panel mt-4 flex items-start gap-4 text-[14px] leading-relaxed">
          <div className="grid h-12 w-12 flex-none place-items-center rounded-full bg-mint/20 text-[24px]">
            📍
          </div>
          <div>
            <h2 className="mb-1 font-display text-[17px] font-black text-cream">
              Who operates this site
            </h2>
            <p>
              Cinema Dub (<strong className="text-cream">dubthatmovie.com</strong>)
              is operated by <strong className="text-cream">Busuioc Nichita</strong>,
              based in <strong className="text-cream">Chișinău, Moldova</strong>.
            </p>
          </div>
        </div>

        {/* Links */}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/about" className="g-btn g-btn-primary">
            About us
          </Link>
          <Link href="/privacy" className="g-btn g-btn-ghost">
            Privacy Policy
          </Link>
          <Link href="/" className="g-btn g-btn-ghost">
            ← Back to Cinema Dub
          </Link>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
