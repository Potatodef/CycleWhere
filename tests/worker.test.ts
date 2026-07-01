import { describe, expect, it } from "vitest";
import { app } from "../worker/index.js";

describe("worker health endpoint", () => {
  it("does not expose backing-service flags", async () => {
    const response = await app.request("/api/health");
    const payload = (await response.json()) as {
      ok: boolean;
      service: string;
      timestamp: string;
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe("cyclewhere-api");
    expect(payload).not.toHaveProperty("hasD1");
    expect(payload).not.toHaveProperty("hasOneMapCredentials");
  });

  it("allows only configured CORS origins", async () => {
    const allowedResponse = await app.request("/api/health", {
      headers: { Origin: "https://cyclewhere.pages.dev" }
    });
    const blockedResponse = await app.request("/api/health", {
      headers: { Origin: "https://evil.example" }
    });

    expect(allowedResponse.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://cyclewhere.pages.dev"
    );
    expect(blockedResponse.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("adds security headers to API responses", async () => {
    const response = await app.request("/api/health");

    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains; preload"
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe("credentialless");
  });
});
