-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "dailyCostCapUsd" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "aiCalls" INTEGER NOT NULL DEFAULT 0,
    "renderSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transcribeSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "publishCount" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_workspaceId_day_key" ON "UsageCounter"("workspaceId", "day");

-- CreateIndex
CREATE INDEX "UsageCounter_day_idx" ON "UsageCounter"("day");
