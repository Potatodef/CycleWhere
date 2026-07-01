import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRouteWithGraphHopper,
  graphHopperProviderMode,
  GraphHopperSystemicError,
  snapMeetupWithGraphHopper
} from "../worker/providers/graphhopper.js";

afterEach(() => vi.unstubAllGlobals());

describe("GraphHopper route provenance", () => {
  it("returns directed edge IDs and converts coordinates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            paths: [
              {
                distance: 6200,
                time: 1_500_000,
                points: { coordinates: [[103.8, 1.3], [103.85, 1.34]] },
                details: { edge_id: [[0, 1, 42], [1, 2, 43]] }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const route = await fetchRouteWithGraphHopper(
      {
        start: { lat: 1.3, lng: 103.8 },
        end: { lat: 1.34, lng: 103.85 },
        profile: "official_protected"
      },
      { GRAPHHOPPER_BASE_URL: "https://routing.example" }
    );

    expect(route?.graphEdgeIds).toEqual(["42", "43"]);
    expect(route?.geometry[1]).toEqual({ lat: 1.34, lng: 103.85 });
    expect(route?.distanceKm).toBe(6.2);
  });

  it("rejects geometry without graph-edge provenance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            paths: [{ distance: 6000, time: 1_500_000, points: { coordinates: [[103.8, 1.3]] } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    await expect(
      fetchRouteWithGraphHopper(
        {
          start: { lat: 1.3, lng: 103.8 },
          end: { lat: 1.34, lng: 103.85 },
          profile: "bicycle"
        },
        { GRAPHHOPPER_BASE_URL: "https://routing.example" }
      )
    ).rejects.toThrow("edge provenance");
  });

  it("uses the hosted API bike profile when only an API key is configured", async () => {
    let capturedUrl = "";
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(
        JSON.stringify({
          paths: [
            {
              distance: 6200,
              time: 1_500_000,
              points: { coordinates: [[103.8, 1.3], [103.85, 1.34]] },
              details: { edge_id: [[0, 1, 42], [1, 2, 43]] }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchRouteWithGraphHopper(
      {
        start: { lat: 1.3, lng: 103.8 },
        end: { lat: 1.34, lng: 103.85 },
        profile: "official_protected"
      },
      { GRAPHHOPPER_API_KEY: "test-key" }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(capturedUrl);
    expect(`${requestedUrl.origin}${requestedUrl.pathname}`).toBe("https://graphhopper.com/api/1/route");
    expect(requestedUrl.searchParams.get("key")).toBe("test-key");
    expect(requestedUrl.searchParams.get("profile")).toBe("bike");
    expect(requestedUrl.searchParams.has("details")).toBe(false);
    expect(requestedUrl.searchParams.getAll("point")).toEqual(["1.3,103.8", "1.34,103.85"]);
  });

  it("uses self-hosted mode when both base URL and API key are configured", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      capturedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          paths: [
            {
              distance: 6200,
              time: 1_500_000,
              points: { coordinates: [[103.8, 1.3], [103.85, 1.34]] },
              details: { edge_id: [[0, 1, 42]] }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchRouteWithGraphHopper(
      {
        start: { lat: 1.3, lng: 103.8 },
        end: { lat: 1.34, lng: 103.85 },
        profile: "official_protected"
      },
      { GRAPHHOPPER_BASE_URL: "https://routing.example", GRAPHHOPPER_API_KEY: "test-key" }
    );

    expect(graphHopperProviderMode({ GRAPHHOPPER_BASE_URL: "https://routing.example", GRAPHHOPPER_API_KEY: "test-key" })).toBe(
      "self-hosted"
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe("https://routing.example/route");
    expect(JSON.parse(capturedBody)).toMatchObject({
      profile: "cyclewhere_official",
      details: ["edge_id"]
    });
  });

  it("accepts hosted routes without self-hosted graph edge IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            paths: [
              {
                distance: 6200,
                time: 1_500_000,
                points: { coordinates: [[103.8, 1.3], [103.85, 1.34]] }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const route = await fetchRouteWithGraphHopper(
      {
        start: { lat: 1.3, lng: 103.8 },
        end: { lat: 1.34, lng: 103.85 },
        profile: "bicycle"
      },
      { GRAPHHOPPER_API_KEY: "test-key" }
    );

    expect(route?.graphEdgeIds).toBeUndefined();
    expect(route?.geometry).toEqual([
      { lat: 1.3, lng: 103.8 },
      { lat: 1.34, lng: 103.85 }
    ]);
  });

  it("treats malformed hosted route geometry as an unroutable candidate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            paths: [
              {
                distance: 6200,
                time: 1_500_000,
                points: { coordinates: [[103.8, null]] }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(
      fetchRouteWithGraphHopper(
        {
          start: { lat: 1.3, lng: 103.8 },
          end: { lat: 1.34, lng: 103.85 },
          profile: "bicycle"
        },
        { GRAPHHOPPER_API_KEY: "test-key" }
      )
    ).resolves.toBeNull();
  });

  it("treats malformed hosted route metrics as an unroutable candidate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            paths: [
              {
                distance: null,
                time: 1_500_000,
                points: { coordinates: [[103.8, 1.3], [103.85, 1.34]] }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(
      fetchRouteWithGraphHopper(
        {
          start: { lat: 1.3, lng: 103.8 },
          end: { lat: 1.34, lng: 103.85 },
          profile: "bicycle"
        },
        { GRAPHHOPPER_API_KEY: "test-key" }
      )
    ).resolves.toBeNull();
  });

  it("treats hosted no-path responses as an unroutable candidate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "Cannot find point" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(
      fetchRouteWithGraphHopper(
        {
          start: { lat: 1.3, lng: 103.8 },
          end: { lat: 1.34, lng: 103.85 },
          profile: "bicycle"
        },
        { GRAPHHOPPER_API_KEY: "test-key" }
      )
    ).resolves.toBeNull();
  });

  it("treats self-hosted no-path responses as an unroutable candidate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "Cannot find point" }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(
      fetchRouteWithGraphHopper(
        {
          start: { lat: 1.3, lng: 103.8 },
          end: { lat: 1.34, lng: 103.85 },
          profile: "bicycle"
        },
        { GRAPHHOPPER_BASE_URL: "https://routing.example" }
      )
    ).resolves.toBeNull();
  });

  it("marks hosted provider failures as systemic", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "upstream unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(
      fetchRouteWithGraphHopper(
        {
          start: { lat: 1.3, lng: 103.8 },
          end: { lat: 1.34, lng: 103.85 },
          profile: "bicycle"
        },
        { GRAPHHOPPER_API_KEY: "test-key" }
      )
    ).rejects.toMatchObject({
      name: "GraphHopperSystemicError",
      routingFailureKind: "systemic",
      status: 503
    } satisfies Partial<GraphHopperSystemicError>);
  });

  it("skips explicit nearest snapping in hosted API mode", async () => {
    const snapped = await snapMeetupWithGraphHopper(
      { lat: 1.3, lng: 103.8 },
      { GRAPHHOPPER_API_KEY: "test-key" }
    );

    expect(snapped).toEqual({
      point: { lat: 1.3, lng: 103.8 },
      distanceMeters: 0
    });
  });

  it("rejects malformed self-hosted nearest snapping coordinates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ coordinates: [103.8, null], distance: 12 }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(
      snapMeetupWithGraphHopper(
        { lat: 1.3, lng: 103.8 },
        { GRAPHHOPPER_BASE_URL: "https://routing.example" }
      )
    ).resolves.toBeNull();
  });

  it("rejects the legacy single-h secret name", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          paths: [
            {
              distance: 6200,
              time: 1_500_000,
              points: { coordinates: [[103.8, 1.3], [103.85, 1.34]] },
              details: { edge_id: [[0, 1, 42], [1, 2, 43]] }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      fetchRouteWithGraphHopper(
        {
          start: { lat: 1.3, lng: 103.8 },
          end: { lat: 1.34, lng: 103.85 },
          profile: "bicycle"
        },
        { GRAPHOPPER_API_KEY: "legacy-key" } as unknown as Parameters<typeof fetchRouteWithGraphHopper>[1]
      )
    ).rejects.toThrow("GraphHopper is not configured");

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
