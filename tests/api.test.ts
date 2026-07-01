import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouteSearch, fetchTransitTimes, loadRouteSearchPage } from "../src/lib/api.js";

const transitQuery = {
  from: { lat: 1.3, lng: 103.8 },
  to: { lat: 1.36, lng: 103.9 },
  departureIso: "2026-06-24T10:00:00.000Z",
  modeHint: "rail" as const
};

afterEach(() => {
  delete (window as Window & { __CYCLEWHERE_CONFIG__?: unknown }).__CYCLEWHERE_CONFIG__;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  it("reads runtime API config at request time", async () => {
    (window as Window & { __CYCLEWHERE_CONFIG__?: { apiBase?: string } }).__CYCLEWHERE_CONFIG__ = {
      apiBase: "https://runtime.example"
    };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          searchId: "search-1",
          routes: [],
          zoneStatuses: [],
          liveDiscoveryStatus: "unavailable",
          graphVersion: "test",
          nextPageToken: null,
          expiresAt: "2026-06-24T10:30:00.000Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await createRouteSearch({
      start: { label: "Marina Bay", point: { lat: 1.28, lng: 103.85 } },
      departureIso: "2026-06-24T10:00:00.000Z",
      participants: []
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example/api/route-searches",
      expect.any(Object)
    );
  });

  it("retries transient route-search network failures", async () => {
    (window as Window & { __CYCLEWHERE_CONFIG__?: { apiBase?: string } }).__CYCLEWHERE_CONFIG__ = {
      apiBase: "https://runtime.example"
    };
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            searchId: "search-1",
            routes: [],
            zoneStatuses: [],
            liveDiscoveryStatus: "unavailable",
            graphVersion: "test",
            nextPageToken: null,
            expiresAt: "2026-06-24T10:30:00.000Z"
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await createRouteSearch({
      start: { label: "Marina Bay", point: { lat: 1.28, lng: 103.85 } },
      departureIso: "2026-06-24T10:00:00.000Z",
      participants: []
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("transit-time API", () => {
  it("preserves OneMap transit result sources", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [{ minutes: 31, source: "onemap" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTransitTimes([transitQuery])).resolves.toEqual([
      { minutes: 31, source: "onemap" }
    ]);
  });

  it("marks local transit fallback values as estimates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const [result] = await fetchTransitTimes([transitQuery]);

    expect(result?.source).toBe("estimate");
    expect(typeof result?.minutes).toBe("number");
  });
});
