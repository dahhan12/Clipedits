-- CreateEnum
CREATE TYPE "PermissionStatus" AS ENUM ('UNVERIFIED', 'PROVISIONAL', 'VERIFIED', 'REVOKED', 'DENIED');

-- CreateEnum
CREATE TYPE "TransformationType" AS ENUM ('DOWNLOAD', 'CLIP', 'MODIFY', 'CAPTION', 'OVERLAY', 'PUBLISH');

-- CreateTable
CREATE TABLE "AssetPermission" (
    "id" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "campaignRevisionId" TEXT,
    "permissionType" TEXT NOT NULL,
    "permittedPlatforms" "Platform"[] DEFAULT ARRAY[]::"Platform"[],
    "permittedTransformations" "TransformationType"[] DEFAULT ARRAY[]::"TransformationType"[],
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "evidenceUrl" TEXT,
    "evidenceExcerpt" TEXT,
    "evidenceHash" TEXT,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "status" "PermissionStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleEvidence" (
    "id" TEXT NOT NULL,
    "campaignRevisionId" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL,
    "excerpt" TEXT,
    "screenshotStorageKey" TEXT,
    "contentHash" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPolicySnapshot" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUrl" TEXT,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "restrictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredHumanActions" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "PlatformPolicySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetPermission_sourceAssetId_status_idx" ON "AssetPermission"("sourceAssetId", "status");

-- CreateIndex
CREATE INDEX "RuleEvidence_campaignRevisionId_fieldPath_idx" ON "RuleEvidence"("campaignRevisionId", "fieldPath");

-- CreateIndex
CREATE INDEX "PlatformPolicySnapshot_platform_capturedAt_idx" ON "PlatformPolicySnapshot"("platform", "capturedAt");

-- AddForeignKey
ALTER TABLE "AssetPermission" ADD CONSTRAINT "AssetPermission_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "SourceAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

