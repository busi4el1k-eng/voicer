import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · Cinema Dub",
  description: "How Cinema Dub collects, uses, and protects your data.",
};

// Static legal page — kept in English (the app default) and deliberately plain
// so it's easy to read and to keep accurate. Linked from the AdSense consent
// message and required for AdSense approval. Public route (see proxy.ts).
export default function PrivacyPage() {
  const updated = "15 August 2026";
  return (
    <main className="g-screen">
      <div className="flex h-[72px] items-center">
        <Link href="/" className="g-logo">
          Cinema<em>Dub</em>
        </Link>
      </div>

      <div className="w-full max-w-3xl pb-16 text-left text-cream/85">
        <h1 className="g-title mb-1">Privacy Policy</h1>
        <p className="mb-6 text-[13px] text-cream/50">Last updated: {updated}</p>

        <div className="g-panel space-y-6 text-[14px] leading-relaxed">
          <section>
            <p>
              Cinema Dub (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates the website{" "}
              <strong>dubthatmovie.com</strong>, a game where players record dubs
              over short video clips. This policy explains what data we collect,
              why, and the choices you have. By using the site you agree to this
              policy.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-display text-[17px] font-black text-cream">
              Information we collect
            </h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Account data.</strong> If you create an account, our
                authentication provider (Clerk) stores your display name and
                email address. You can play as a guest without an account.
              </li>
              <li>
                <strong>Content you create.</strong> Videos you upload and audio
                you record while dubbing, plus the dubbed videos you produce and
                any ratings you give.
              </li>
              <li>
                <strong>Technical data.</strong> A random guest identifier and
                your chosen language, stored in cookies; and standard log data
                (IP address, browser type) processed by our hosting.
              </li>
              <li>
                <strong>Usage &amp; analytics.</strong> Anonymous product
                analytics (pages viewed, buttons clicked) via PostHog to improve
                the game.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-display text-[17px] font-black text-cream">
              How we use it
            </h2>
            <p>
              To run the game (record, process, and play back dubs), to keep
              your scores and ratings, to secure the service and prevent abuse,
              to understand how the site is used, and to show advertising.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-display text-[17px] font-black text-cream">
              Cookies &amp; advertising
            </h2>
            <p className="mb-2">
              We use cookies for essential features (guest identity, language)
              and analytics. We also show ads through <strong>Google
              AdSense</strong>.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Third-party vendors, including Google, use cookies to serve ads
                based on your prior visits to this and other websites.
              </li>
              <li>
                Google&rsquo;s use of advertising cookies enables it and its
                partners to serve ads to you based on your visits. You can opt
                out of personalized advertising by visiting{" "}
                <a
                  className="text-mint underline"
                  href="https://www.google.com/settings/ads"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Ads Settings
                </a>
                .
              </li>
              <li>
                For visitors in the EEA, UK, and Switzerland, we show a consent
                banner and only serve personalized ads with your consent, as
                required by GDPR.
              </li>
              <li>
                Learn more about how Google uses data at{" "}
                <a
                  className="text-mint underline"
                  href="https://policies.google.com/technologies/partner-sites"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  policies.google.com/technologies/partner-sites
                </a>
                .
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-display text-[17px] font-black text-cream">
              Service providers
            </h2>
            <p>
              We share data only with the processors needed to run the service:
              Clerk (accounts), Neon (database), DigitalOcean (hosting &amp;
              file storage), PostHog (analytics), Google AdSense (advertising),
              and speech/audio processing services used to prepare clips. We do
              not sell your personal data.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-display text-[17px] font-black text-cream">
              Data retention
            </h2>
            <p>
              Recorded audio takes are temporary and automatically deleted about
              24 hours after a game. Uploaded and produced videos are kept while
              they remain available in the library or via a shared link, until
              you or we delete them. Account data is kept until you delete your
              account.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-display text-[17px] font-black text-cream">
              Your rights
            </h2>
            <p>
              Depending on where you live, you may have the right to access,
              correct, or delete your personal data, and to withdraw consent. To
              make a request, contact us using the details below.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-display text-[17px] font-black text-cream">
              Children
            </h2>
            <p>
              Cinema Dub is not directed to children under 13, and we do not
              knowingly collect their personal data.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-display text-[17px] font-black text-cream">
              Contact
            </h2>
            <p>
              Questions or requests:{" "}
              <a className="text-mint underline" href="mailto:nichitabusuioc@gmail.com">
                nichitabusuioc@gmail.com
              </a>
              . We may update this policy from time to time; the date above shows
              the latest revision.
            </p>
          </section>
        </div>

        <div className="mt-6">
          <Link href="/" className="text-[13px] text-cream/60 underline">
            ← Back to Cinema Dub
          </Link>
        </div>
      </div>
    </main>
  );
}
