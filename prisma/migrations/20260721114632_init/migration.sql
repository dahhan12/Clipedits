-- CreateEnum
CREATE TYPE "CampaignSource" AS ENUM ('CONTENT_REWARDS', 'WHOP_FORUM');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DISCOVERED', 'PARSING', 'PARSED', 'NEEDS_MANUAL_REVIEW', 'ACTIVE', 'PAUSED', 'CLOSED', 'ERROR');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('PARSED', 'NEEDS_MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('DIRECT_VIDEO', 'GOOGLE_DRIVE_FILE', 'GOOGLE_DRIVE_FOLDER', 'DROPBOX_FILE', 'DROPBOX_FOLDER', 'YOUTUBE', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('DISCOVERED', 'APPROVED', 'REJECTED', 'DOWNLOADED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('CANDIDATE', 'REJECTED', 'APPROVED', 'RENDERING', 'RENDERED', 'FAILED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TIKTOK', 'INSTAGRAM_REELS', 'YOUTUBE_SHORTS');

-- CreateEnum
CREATE TYPE "ComplianceOutcome" AS ENUM ('PASS', 'FAIL', 'REVIEW');

-- CreateEnum
CREATE TYPE "PublicationMode" AS ENUM ('AUTO', 'DRAFT', 'MANUAL');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PENDING', 'DRAFTED', 'PUBLISHED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PREPARED', 'AWAITING_CONFIRMATION', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "source" "CampaignSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DISCOVERED',
    "lastPageHash" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRevision" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "pageHash" TEXT NOT NULL,
    "rawSnapshot" TEXT,
    "budgetTotal" DOUBLE PRECISION,
    "budgetRemaining" DOUBLE PRECISION,
    "status" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRule" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'PARSED',
    "rules" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "uncertainties" JSONB,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignResource" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "url" TEXT NOT NULL,
    "status" "ResourceStatus" NOT NULL DEFAULT 'DISCOVERED',
    "permitted" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAsset" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "resourceId" TEXT,
    "originalSource" TEXT NOT NULL,
    "storageKey" TEXT,
    "checksum" TEXT NOT NULL,
    "mimeType" TEXT,
    "bytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "downloadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transcript" JSONB,

    CONSTRAINT "SourceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipCandidate" (
    "id" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "status" "ClipStatus" NOT NULL DEFAULT 'CANDIDATE',
    "rejectionReason" TEXT,
    "scores" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderedClip" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "storageKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "videoCodec" TEXT DEFAULT 'h264',
    "audioCodec" TEXT DEFAULT 'aac',
    "renderManifest" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderedClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceResult" (
    "id" TEXT NOT NULL,
    "renderedClipId" TEXT NOT NULL,
    "ruleId" TEXT,
    "check" TEXT NOT NULL,
    "outcome" "ComplianceOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "deterministic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "externalId" TEXT,
    "encryptedRefreshToken" TEXT,
    "scopes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "renderedClipId" TEXT NOT NULL,
    "accountId" TEXT,
    "platform" "Platform" NOT NULL,
    "mode" "PublicationMode" NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "postUrl" TEXT,
    "externalPostId" TEXT,
    "publicVerified" BOOLEAN NOT NULL DEFAULT false,
    "captionText" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSubmission" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PREPARED',
    "submittedAt" TIMESTAMP(3),
    "approvalState" TEXT,
    "rejectionReason" TEXT,
    "qualifiedViews" INTEGER,
    "estimatedEarnings" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "payload" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "role" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_source_externalId_key" ON "Campaign"("source", "externalId");

-- CreateIndex
CREATE INDEX "CampaignRevision_campaignId_capturedAt_idx" ON "CampaignRevision"("campaignId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRevision_campaignId_pageHash_key" ON "CampaignRevision"("campaignId", "pageHash");

-- CreateIndex
CREATE INDEX "CampaignRule_campaignId_createdAt_idx" ON "CampaignRule"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignResource_campaignId_url_key" ON "CampaignResource"("campaignId", "url");

-- CreateIndex
CREATE INDEX "SourceAsset_status_idx" ON "SourceAsset"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceAsset_campaignId_checksum_key" ON "SourceAsset"("campaignId", "checksum");

-- CreateIndex
CREATE INDEX "ClipCandidate_sourceAssetId_status_idx" ON "ClipCandidate"("sourceAssetId", "status");

-- CreateIndex
CREATE INDEX "RenderedClip_candidateId_idx" ON "RenderedClip"("candidateId");

-- CreateIndex
CREATE INDEX "ComplianceResult_renderedClipId_outcome_idx" ON "ComplianceResult"("renderedClipId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_platform_handle_key" ON "SocialAccount"("platform", "handle");

-- CreateIndex
CREATE INDEX "Publication_status_idx" ON "Publication"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_renderedClipId_platform_idempotencyKey_key" ON "Publication"("renderedClipId", "platform", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSubmission_publicationId_key" ON "CampaignSubmission"("publicationId");

-- CreateIndex
CREATE INDEX "CampaignSubmission_status_idx" ON "CampaignSubmission"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSubmission_campaignId_publicationId_key" ON "CampaignSubmission"("campaignId", "publicationId");

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_queue_jobKey_key" ON "JobRun"("queue", "jobKey");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "CampaignRevision" ADD CONSTRAINT "CampaignRevision_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRule" ADD CONSTRAINT "CampaignRule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignResource" ADD CONSTRAINT "CampaignResource_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAsset" ADD CONSTRAINT "SourceAsset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAsset" ADD CONSTRAINT "SourceAsset_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "CampaignResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipCandidate" ADD CONSTRAINT "ClipCandidate_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "SourceAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderedClip" ADD CONSTRAINT "RenderedClip_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ClipCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceResult" ADD CONSTRAINT "ComplianceResult_renderedClipId_fkey" FOREIGN KEY ("renderedClipId") REFERENCES "RenderedClip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceResult" ADD CONSTRAINT "ComplianceResult_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CampaignRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_renderedClipId_fkey" FOREIGN KEY ("renderedClipId") REFERENCES "RenderedClip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSubmission" ADD CONSTRAINT "CampaignSubmission_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSubmission" ADD CONSTRAINT "CampaignSubmission_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
