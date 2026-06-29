import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouteSearch, loadRouteSearchPage } from "../src/lib/api.js";

afterEach(() => vi.unstubAllGlobals());

describe("route-search API errors", () => {
  it("turns route-search network failures into retryable routing errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    await expect(
      createRouteSearch({
        start: { label: "Marina Bay", point: { lat: 1.28, lng: 103.85 } },
        departureIso: "2026-06-24T10:00:00.000Z",
        participants: []
      })
    ).rejects.toMatchObject({
      code: "routing_network_error"
    });
  });

  it("turns paginated route-search network failures into retryable routing errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    await expect(loadRouteSearchPage("next-page")).rejects.toMatchObject({
      code: "routing_network_error"
    });
  });

  it("turns unreadable route-search responses into routing_unavailable errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<h1>Method not allowed</h1>", { status: 405 }))
    );

    await expect(
      createRouteSearch({
        start: { label: "Marina Bay", point: { lat: 1.28, lng: 103.85 } },
        departureIso: "2026-06-24T10:00:00.000Z",
        participants: []
      })
    ).rejects.toMatchObject({
      code: "routing_unavailable",
      status: 405
    });
  });
});
