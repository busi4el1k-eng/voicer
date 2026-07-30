// Clerk is optional: the whole game is playable as a guest. We only mount the
// provider / middleware when real keys are configured, so local dev (and the
// guest path in production) works before Clerk is set up. Dashboard + saved
// stats are the only surfaces that actually require it.
export function isClerkConfigured(): boolean {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const sk = process.env.CLERK_SECRET_KEY ?? "";
  const pkOk = pk.startsWith("pk_") && !pk.includes("REPLACE_ME");
  // Secret key only exists server-side; when it's absent (client bundle) we fall
  // back to the pk check so ClerkProvider can still mount on the client.
  const skOk = sk === "" ? true : sk.startsWith("sk_") && !sk.includes("REPLACE_ME");
  return pkOk && skOk;
}
