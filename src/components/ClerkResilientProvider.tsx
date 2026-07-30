"use client";

import { Component, createContext, useContext, type ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";

// True when ClerkProvider failed to initialize (e.g. clerk.browser.js couldn't
// load). Descendants use this to fall back to the guest UI instead of calling
// Clerk hooks that would throw without a working provider.
const ClerkFailedContext = createContext(false);
export const useClerkFailed = () => useContext(ClerkFailedContext);

// Guards a Clerk-only subtree: renders `children` when Clerk works, or a small
// notice when Clerk failed to load (used by the sign-in / sign-up pages).
export function ClerkGate({ children }: { children: ReactNode }) {
  if (useClerkFailed()) {
    return (
      <p className="max-w-sm text-center text-[14px] text-cream/60">
        Sign-in is temporarily unavailable (couldn&apos;t reach the auth service). You can keep
        playing as a guest.
      </p>
    );
  }
  return <>{children}</>;
}

class ClerkBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("Clerk failed to initialize — falling back to guest mode.", err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Mounts ClerkProvider, but if it throws (Clerk JS load failure) it renders the
// same app shell in guest mode instead of crashing to a blank page.
export function ClerkResilientProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkBoundary
      fallback={<ClerkFailedContext.Provider value={true}>{children}</ClerkFailedContext.Provider>}
    >
      <ClerkProvider>{children}</ClerkProvider>
    </ClerkBoundary>
  );
}
