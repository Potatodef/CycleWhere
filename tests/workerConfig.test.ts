import { describe, expect, it } from "vitest";
import networkManifest from "../public/data/network-manifest.json";
import wrangler from "../wrangler.toml?raw";

describe("worker deployment metadata", () => {
  it("keeps wrangler graph metadata aligned with the network manifest", async () => {
    const graphVersions = [...wrangler.matchAll(/^GRAPH_VERSION = "([^"]+)"$/gm)].map((match) => match[1]);
    const overlayHashes = [...wrangler.matchAll(/^OVERLAY_HASH = "([^"]+)"$/gm)].map((match) => match[1]);

    expect(graphVersions).not.toHaveLength(0);
    expect(overlayHashes).not.toHaveLength(0);
    expect(graphVersions.every((version) => version === networkManifest.version)).toBe(true);
    expect(overlayHashes.every((hash) => hash === `verified-network-${networkManifest.version}`)).toBe(true);
  });
});
