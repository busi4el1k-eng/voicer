import { PrismaClient } from "@prisma/client";

// Singleton kept on globalThis so Next.js hot-reloads reuse one connection pool.
// Same pattern as ../digital_standarts/src/lib/prisma.ts.
const prismaClientSingleton = () => new PrismaClient();

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const db = globalThis.prismaGlobal ?? prismaClientSingleton();

export default db;

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = db;
