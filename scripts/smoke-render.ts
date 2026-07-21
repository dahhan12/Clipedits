/** One-off: run transcribe -> clip -> render -> compliance on a seeded asset. */
import { prisma } from "@/lib/db/prisma";
import { sha256Hex } from "@/lib/security/crypto";
import { transcribeAsset } from "@/services/pipeline/transcribeService";
import { generateClipCandidates } from "@/services/pipeline/clipCandidateService";
import { renderCandidate } from "@/services/render/renderService";
import { evaluateCompliance } from "@/services/compliance/complianceService";

async function main() {
  const campaignId = process.argv[2]!;
  const storageKey = `campaigns/${campaignId}/resources/smoke/src.mp4`;

  const asset = await prisma.sourceAsset.upsert({
    where: { campaignId_checksum: { campaignId, checksum: sha256Hex("smoke-src") } },
    create: {
      campaignId,
      originalSource: "https://cdn.example.com/smoke/src.mp4",
      storageKey,
      checksum: sha256Hex("smoke-src"),
      mimeType: "video/mp4",
      status: "READY",
      downloadedAt: new Date(),
    },
    update: { storageKey, status: "READY" },
  });
  console.log("asset", asset.id);

  await transcribeAsset(asset.id);
  const gen = await generateClipCandidates(asset.id);
  console.log("candidates", gen);

  const candidate = await prisma.clipCandidate.findFirst({
    where: { sourceAssetId: asset.id, status: "CANDIDATE" },
    orderBy: { startSec: "asc" },
  });
  if (!candidate) throw new Error("no CANDIDATE produced");
  await prisma.clipCandidate.update({ where: { id: candidate.id }, data: { status: "APPROVED" } });

  const rendered = await renderCandidate(candidate.id);
  if (!rendered) throw new Error("render returned null");
  const clip = await prisma.renderedClip.findUnique({ where: { id: rendered.renderedClipId } });
  console.log("rendered", {
    id: clip?.id,
    dims: `${clip?.width}x${clip?.height}`,
    bytes: clip?.bytes,
    codecs: `${clip?.videoCodec}/${clip?.audioCodec}`,
    thumbnail: !!clip?.thumbnailKey,
  });

  const compliance = await evaluateCompliance(rendered.renderedClipId);
  const results = await prisma.complianceResult.findMany({ where: { renderedClipId: rendered.renderedClipId } });
  console.log("compliance overall:", compliance?.outcome);
  console.log(
    "checks:",
    results.map((r) => `${r.check}=${r.outcome}`).join(", "),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
