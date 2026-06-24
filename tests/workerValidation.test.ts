import { describe, expect, it } from "vitest";
import { app } from "../worker/index.js";

describe("worker request validation", () => {
  it("returns 400 for malformed geocode JSON", async () => {
    const response = await app.request("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json"
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Malformed JSON request body."
    });
  });

  it("returns 400 for malformed transit queries", async () => {
    const response = await app.request("/api/transit-times", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [{ foo: 1 }] })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid transit query."
    });
  });

  it("returns 422 for invalid route-search dates before provider calls", async () => {
    const response = await app.request("/api/route-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { label: "Marina Bay", point: { lat: 1.2808, lng: 103.8545 } },
        departureIso: "not-a-date",
        participants: [
          {
            id: "a",
            name: "A",
            station: { lat: 1.32403889, lng: 103.93003611 },
            anchor: {
              id: "bedok-mrt",
              name: "Bedok MRT",
              kind: "rail",
              point: { lat: 1.32403889, lng: 103.93003611 },
              distanceFromHomeKm: 0,
              fallbackSuggested: false
            }
          }
        ]
      })
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_meetup",
      error: "Invalid departure time."
    });
  });

  it("returns 422 for malformed route-search participants before provider calls", async () => {
    const response = await app.request("/api/route-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { label: "Marina Bay", point: { lat: 1.2808, lng: 103.8545 } },
        departureIso: "2026-06-24T10:00:00.000Z",
        participants: [{ id: "a", name: "A" }]
      })
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_meetup",
      error: "Invalid participant station or anchor."
    });
  });
});
