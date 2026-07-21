-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CampaignSubmission" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ClipCandidate" ADD COLUMN     "scoringVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PostMetric" ADD COLUMN     "providerCapturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RenderedClip" ADD COLUMN     "audioHash" TEXT,
ADD COLUMN     "perceptualHash" TEXT,
ADD COLUMN     "renderConfigHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "ClipCandidate_sourceAssetId_startSec_endSec_scoringVersion_key" ON "ClipCandidate"("sourceAssetId", "startSec", "endSec", "scoringVersion");

-- CreateIndex
CREATE UNIQUE INDEX "PostMetric_publicationId_providerCapturedAt_key" ON "PostMetric"("publicationId", "providerCapturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RenderedClip_candidateId_renderConfigHash_key" ON "RenderedClip"("candidateId", "renderConfigHash");

