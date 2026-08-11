import type { Metadata } from "next";
import { Fredoka, Nunito } from "next/font/google";
import { ClerkResilientProvider } from "@/components/ClerkResilientProvider";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { BackButton } from "@/components/BackButton";
import { LanguageProvider } from "@/components/LanguageProvider";
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const shell = (
    <html lang="en" className={`${fredoka.variable} ${nunito.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <LanguageProvider>
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
