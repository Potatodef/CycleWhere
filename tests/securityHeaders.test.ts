import { describe, expect, it } from "vitest";
import pagesHeaders from "../public/_headers?raw";

describe("Pages security headers", () => {
  it("keeps the deployed CSP free of inline-style allowances", () => {
    const cspLine = pagesHeaders
      .split("\n")
      .find((line) => line.trim().startsWith("Content-Security-Policy:"));

    expect(cspLine).toContain("style-src 'self' https://fonts.googleapis.com");
    expect(cspLine).not.toContain("'unsafe-inline'");
    expect(cspLine).toContain("frame-ancestors 'none'");
  });

  it("declares the expected browser security headers", () => {
    expect(pagesHeaders).toContain("Access-Control-Allow-Origin: https://cyclewhere.pages.dev");
    expect(pagesHeaders).not.toContain("Access-Control-Allow-Origin: *");
    expect(pagesHeaders).toContain(
      "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload"
    );
    expect(pagesHeaders).toContain("X-Frame-Options: DENY");
    expect(pagesHeaders).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(pagesHeaders).toContain("Cross-Origin-Embedder-Policy: credentialless");
  });
});
