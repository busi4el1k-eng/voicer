import { SignUp } from "@clerk/nextjs";
import { ClerkGate } from "@/components/ClerkResilientProvider";

export default function SignupPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <ClerkGate>
        <SignUp routing="hash" signInUrl="/login" />
      </ClerkGate>
    </main>
  );
}
