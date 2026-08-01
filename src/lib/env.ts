import { z } from "zod";

// Validated environment access. Fails loudly at boot with the offending variable
// name rather than surfacing an undefined deep in a request. Never inline a secret.
const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Recorded-take storage (Cloudflare R2 / S3-compatible). Optional until wired.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // Demucs source-separation service (keeps original music when dubbing).
  // Optional: without it, renders fall back to muting the sector (no music).
  DEMUCS_URL: z.string().url().optional(),
  DEMUCS_API_KEY: z.string().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SOCKET_URL: z.string().url().optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, source: Record<string, unknown>): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${missing}`);
  }
  return result.data;
}

// Client vars must be referenced statically for Next to inline them.
export const clientEnv = parse(clientSchema, {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL,
});

// Server env is parsed lazily so client bundles never trip the server schema.
let _serverEnv: z.infer<typeof serverSchema> | null = null;
export function serverEnv() {
  if (_serverEnv) return _serverEnv;
  _serverEnv = parse(serverSchema, process.env);
  return _serverEnv;
}
