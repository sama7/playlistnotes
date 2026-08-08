import { PrismaClient } from "@prisma/client";

/**
 * A single PrismaClient per process. Next.js dev-mode hot reloading would
 * otherwise open a new pool on every reload and exhaust connections — which
 * matters more in production, where DigitalOcean's smallest Managed PostgreSQL
 * node allows roughly 22 backends in total.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
