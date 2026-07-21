-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_idx" ON "Campaign"("workspaceId");

