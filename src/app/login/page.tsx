import { SignIn } from "@clerk/nextjs";
import { ClerkGate } from "@/components/ClerkResilientProvider";

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <ClerkGate>
        <SignIn routing="hash" signUpUrl="/signup" />
      </ClerkGate>
    </main>
  );
}
