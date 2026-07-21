-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'DEAD_LETTER';

-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN     "failureCategory" TEXT,
ADD COLUMN     "deadLetteredAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "JobRun_status_deadLetteredAt_idx" ON "JobRun"("status", "deadLetteredAt");

-- CreateTable
CREATE TABLE "ProviderStat" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    "maxMs" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderStat_provider_operation_day_key" ON "ProviderStat"("provider", "operation", "day");

-- CreateIndex
CREATE INDEX "ProviderStat_provider_idx" ON "ProviderStat"("provider");
