-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "PrePublicationReview" (
    "id" TEXT NOT NULL,
    "renderedClipId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "mode" "PublicationMode" NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "acknowledgedChecks" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrePublicationReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrePublicationReview_renderedClipId_platform_createdAt_idx" ON "PrePublicationReview"("renderedClipId", "platform", "createdAt");

-- AddForeignKey
ALTER TABLE "PrePublicationReview" ADD CONSTRAINT "PrePublicationReview_renderedClipId_fkey" FOREIGN KEY ("renderedClipId") REFERENCES "RenderedClip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
