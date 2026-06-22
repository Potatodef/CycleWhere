import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRouteWithGraphHopper, snapMeetupWithGraphHopper } from "../worker/providers/graphhopper.js";

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
    expect(requestedUrl.searchParams.getAll("point")).toEqual(["1.3,103.8", "1.34,103.85"]);
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

  it("accepts the legacy single-h secret name for hosted API mode", async () => {
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

    await fetchRouteWithGraphHopper(
      {
        start: { lat: 1.3, lng: 103.8 },
        end: { lat: 1.34, lng: 103.85 },
        profile: "bicycle"
      },
      { GRAPHOPPER_API_KEY: "legacy-key" }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
