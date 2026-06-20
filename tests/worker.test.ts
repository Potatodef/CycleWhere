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
});
