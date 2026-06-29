/**
 * Pure routing for the mobile gateway (the throwaway PWA-spike server that
 * serves the web build and reverse-proxies auth so the browser never makes a
 * cross-origin request to `authn.traycer.ai`).
 *
 * Two concerns, both same-origin from the PWA's point of view:
 *   - `/authn/<rest>`  → proxy to `${authnOrigin}/<rest>` (server-side; no CORS)
 *   - everything else  → a static asset, or the SPA `index.html` fallback for
 *     client-routed paths (`/epics/…`).
 *
 * This module decides authn-vs-static and sanitizes the static path; the server
 * performs the actual file read / proxy and the index.html fallback (which
 * depends on file existence, an IO concern kept out of here).
 */

const AUTHN_PREFIX = "/authn/";

export type GatewayRoute =
  | { readonly kind: "authn"; readonly upstreamPath: string }
  | { readonly kind: "discover" }
  | { readonly kind: "static"; readonly relativePath: string };

/** Strip the query/hash and percent-decode a request path. */
function normalizePath(rawPath: string): string {
  const withoutQuery = rawPath.split("?")[0].split("#")[0];
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

/**
 * `true` when a decoded path could escape the web root (`..` segment, an
 * absolute/UNC prefix, or a NUL byte). The server treats these as the SPA
 * fallback rather than reading the file.
 */
export function isUnsafeStaticPath(decodedPath: string): boolean {
  if (decodedPath.includes("\0")) {
    return true;
  }
  const segments = decodedPath.split("/");
  return segments.some((segment) => segment === "..");
}

export function routeGatewayRequest(path: string): GatewayRoute {
  const normalized = normalizePath(path);

  if (normalized === "/authn" || normalized.startsWith(AUTHN_PREFIX)) {
    // `/authn` → `/`; `/authn/api/v3/user` → `/api/v3/user`.
    const upstreamPath =
      normalized === "/authn" ? "/" : normalized.slice("/authn".length);
    return { kind: "authn", upstreamPath };
  }

  // Same-origin tailnet discovery: the gateway runs on a node with the
  // `tailscale` CLI, so the PWA fetches `/discover` here instead of each host's
  // bridge — no per-host `/discover` and no CORS.
  if (normalized === "/discover") {
    return { kind: "discover" };
  }

  // Map "/" to the SPA shell; otherwise strip the leading slash to a relative
  // asset path the server resolves under the web root.
  const relativePath =
    normalized === "/" ? "index.html" : normalized.replace(/^\/+/, "");
  return { kind: "static", relativePath };
}
