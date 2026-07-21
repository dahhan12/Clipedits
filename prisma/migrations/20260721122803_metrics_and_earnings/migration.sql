-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('NONE', 'PENDING', 'PROCESSING', 'PAID');

-- AlterTable
ALTER TABLE "CampaignSubmission" ADD COLUMN     "confirmedEarnings" DOUBLE PRECISION,
ADD COLUMN     "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "PostMetric" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "qualifiedViews" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarningsRecord" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "qualifiedViews" INTEGER,
    "estimatedEarnings" DOUBLE PRECISION,
    "confirmedEarnings" DOUBLE PRECISION,
    "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'NONE',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarningsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostMetric_publicationId_capturedAt_idx" ON "PostMetric"("publicationId", "capturedAt");

-- CreateIndex
CREATE INDEX "EarningsRecord_submissionId_recordedAt_idx" ON "EarningsRecord"("submissionId", "recordedAt");

-- AddForeignKey
ALTER TABLE "PostMetric" ADD CONSTRAINT "PostMetric_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsRecord" ADD CONSTRAINT "EarningsRecord_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CampaignSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
