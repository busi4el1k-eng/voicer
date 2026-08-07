import { SignIn } from "@clerk/nextjs";
import { ClerkGate } from "@/components/ClerkResilientProvider";
import { clerkAppearance } from "@/lib/clerk-appearance";

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <header className="text-center">
        <h1 className="g-logo">
          Cinema <em>Dub</em>
        </h1>
        <p className="mt-2 font-display text-[14px] font-bold uppercase tracking-[0.06em] text-cream/55">
          Welcome back to the booth
        </p>
      </header>
      <div className="w-full max-w-[400px]">
        <ClerkGate>
          <SignIn routing="hash" signUpUrl="/signup" appearance={clerkAppearance} />
        </ClerkGate>
      </div>
    </main>
  );
}
