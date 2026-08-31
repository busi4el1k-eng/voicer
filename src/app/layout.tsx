import type { Metadata } from "next";
import { Fredoka, Nunito } from "next/font/google";
import { cookies } from "next/headers";
import { ClerkResilientProvider } from "@/components/ClerkResilientProvider";
import { AdRail } from "@/components/AdRail";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { BackButton } from "@/components/BackButton";
import { LanguageProvider } from "@/components/LanguageProvider";
import { PostHogIdentify } from "@/components/PostHogIdentify";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n";
import { isClerkConfigured } from "@/lib/clerk";
import "./globals.css";
import "./mobile.css";

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const nunito = Nunito({
  variable: "--font-nunito",
  // Cyrillic included so Russian UI text renders in the body font (Nunito is
  // used for titles, buttons and copy). Fredoka has no Cyrillic subset, but it
  // only styles the English brand logo, so that's fine.
  subsets: ["latin", "cyrillic"],
  weight: ["400", "700", "900"],
});

export const metadata: Metadata = {
  title: "Cinema Dub",
  description: "Everyone gets a mic. Nobody gets away with it.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The switcher mirrors the chosen language into a cookie. Reading it here lets
  // SSR paint every page in that language (not just the dashboard), so navigating
  // to any page — or reloading — keeps the language with no English flash.
  const cookieLocale = (await cookies()).get("cinemadub.locale")?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  const shell = (
    <html lang={locale} className={`${fredoka.variable} ${nunito.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <LanguageProvider initialLocale={locale}>
          <PostHogIdentify />
          <AdRail />
          <AnimatedBackground />
          <BackButton />
          {children}
        </LanguageProvider>
      </body>
    </html>
  );

  // Only mount Clerk when configured — guests must be able to play without it.
  // ClerkResilientProvider falls back to the guest shell if Clerk fails to load
  // instead of crashing the whole client to a blank page.
  return isClerkConfigured() ? <ClerkResilientProvider>{shell}</ClerkResilientProvider> : shell;
}
