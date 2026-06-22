import type {
  CandidateEvaluation,
  LiveDiscoveryStatus,
  RouteCandidate,
  RouteSearchPageResult,
  ZoneDiscoveryStatus
} from "../src/types.js";
import type { LatLng } from "../src/types.js";

const PAGE_SIZE = 6;
const SESSION_TTL_MS = 15 * 60 * 1000;

export type MaterializedRouteSearch = {
  searchId: string;
  graphVersion: string;
  profileHash: string;
  overlayHash: string;
  rankingHash: string;
  requestHash: string;
  snappedStart: LatLng;
  expiresAt: string;
  routes: RouteCandidate[];
  diagnostics: CandidateEvaluation[];
  zoneStatuses: ZoneDiscoveryStatus[];
  liveDiscoveryStatus: LiveDiscoveryStatus;
};

type PageTokenPayload = {
  sessionId: string;
  startIndex: number;
  expiresAt: string;
  graphVersion: string;
};

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(signature)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function hashRequest(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createPageToken(payload: PageTokenPayload, secret: string) {
  const encoded = encodeBase64Url(JSON.stringify(payload));
  return `${encoded}.${await sign(encoded, secret)}`;
}

export async function readPageToken(token: string, secret: string): Promise<PageTokenPayload | null> {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || (await sign(encoded, secret)) !== signature) {
    return null;
  }
  try {
    const payload = JSON.parse(decodeBase64Url(encoded)) as PageTokenPayload;
    return Number.isInteger(payload.startIndex) && payload.startIndex >= 0 ? payload : null;
  } catch {
    return null;
  }
}

export function newSearchExpiry(now = Date.now()) {
  return new Date(now + SESSION_TTL_MS).toISOString();
}

export async function storeRouteSearch(database: D1Database, search: MaterializedRouteSearch) {
  await database
    .prepare(
      `INSERT INTO route_search_sessions
       (session_id, graph_version, profile_hash, overlay_hash, ranking_hash, request_hash,
        payload, diagnostics, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      search.searchId,
      search.graphVersion,
      search.profileHash,
      search.overlayHash,
      search.rankingHash,
      search.requestHash,
      JSON.stringify({
        snappedStart: search.snappedStart,
        routes: search.routes,
        zoneStatuses: search.zoneStatuses,
        liveDiscoveryStatus: search.liveDiscoveryStatus
      }),
      JSON.stringify(search.diagnostics),
      search.expiresAt,
      new Date().toISOString()
    )
    .run();
}

export async function loadRouteSearch(database: D1Database, searchId: string) {
  const row = await database
    .prepare(
      `SELECT session_id, graph_version, profile_hash, overlay_hash, ranking_hash, request_hash,
              payload, diagnostics, expires_at
       FROM route_search_sessions WHERE session_id = ?`
    )
    .bind(searchId)
    .first<{
      session_id: string;
      graph_version: string;
      profile_hash: string;
      overlay_hash: string;
      ranking_hash: string;
      request_hash: string;
      payload: string;
      diagnostics: string;
      expires_at: string;
    }>();

  if (!row) {
    return null;
  }
  const payload = JSON.parse(row.payload) as Pick<
    MaterializedRouteSearch,
    "snappedStart" | "routes" | "zoneStatuses" | "liveDiscoveryStatus"
  >;
  return {
    searchId: row.session_id,
    graphVersion: row.graph_version,
    profileHash: row.profile_hash,
    overlayHash: row.overlay_hash,
    rankingHash: row.ranking_hash,
    requestHash: row.request_hash,
    expiresAt: row.expires_at,
    diagnostics: JSON.parse(row.diagnostics) as CandidateEvaluation[],
    ...payload
  } satisfies MaterializedRouteSearch;
}

export async function materializePage(
  search: MaterializedRouteSearch,
  startIndex: number,
  secret: string
): Promise<RouteSearchPageResult> {
  const routes = search.routes.slice(startIndex, startIndex + PAGE_SIZE);
  const nextIndex = startIndex + routes.length;
  return {
    searchId: search.searchId,
    routes,
    zoneStatuses: search.zoneStatuses,
    liveDiscoveryStatus: search.liveDiscoveryStatus,
    graphVersion: search.graphVersion,
    expiresAt: search.expiresAt,
    nextPageToken:
      nextIndex < search.routes.length
        ? await createPageToken(
            {
              sessionId: search.searchId,
              startIndex: nextIndex,
              expiresAt: search.expiresAt,
              graphVersion: search.graphVersion
            },
            secret
          )
        : null
  };
}
