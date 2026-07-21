import { PrismaClient } from "@/generated/prisma";

/**
 * Singleton Prisma client. In dev, hot-reload would otherwise spawn a new
 * client per reload and exhaust connections, so we cache on globalThis.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
