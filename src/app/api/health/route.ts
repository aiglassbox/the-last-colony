import { fileCorpus } from "@/lib/corpus/load";
import { activeProvider } from "@/lib/model/provider";

/**
 * What the settings sheet reads. Enough to answer "why is there no prose?"
 * without opening a terminal — the usual causes are a missing key or a spent
 * quota, and both are invisible from the UI otherwise.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const provider = activeProvider();
  const records = await fileCorpus.all();
  const swaps = await fileCorpus.swaps();

  return Response.json({
    provider: provider ? { vendor: provider.vendor, model: provider.model } : null,
    corpus: {
      records: records.length,
      ancient: records.filter((r) => r.tier === "ancient").length,
      attested: records.filter((r) => r.provenance_class === "ATTESTED").length,
      unverified: records.filter(
        (r) => r.tier === "ancient" && r.verification.status !== "editor_verified",
      ).length,
      swaps: swaps.length,
    },
  });
}
