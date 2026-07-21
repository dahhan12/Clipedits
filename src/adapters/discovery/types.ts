import type { DiscoveredCampaign } from "@/lib/schemas/campaign";

/** Common interface implemented by every discovery source. */
export interface DiscoveryAdapter {
  readonly name: string;
  /** Discover campaigns from this source. Never throws for a single bad card. */
  discover(): Promise<DiscoveredCampaign[]>;
}
