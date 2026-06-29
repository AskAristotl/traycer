import type { StoredAuthTokens } from "@traycer-clients/shared/platform/runner-host";

/**
 * PWA-spike-only sign-in escape hatch.
 *
 * Interactive OAuth can't complete in the browser spike: `platform.traycer.ai`
 * won't redirect back to a tailnet `*.ts.net` origin (the redirect-URI
 * allowlist is upstream and not ours to change). So a desktop-obtained bearer
 * can be injected ONCE via a URL fragment:
 *
 *   https://<host>.ts.net/#devauth=<encodeURIComponent(token)>|<encodeURIComponent(refreshToken)>
 *
 * A fragment (not a query) keeps the token off the wire to the gateway. The
 * caller writes it to the token store and immediately scrubs the fragment, then
 * the normal `AuthService.start()` rehydrate + validate path signs in. The
 * Capacitor shell uses the registered `traycer://` deep-link flow and never
 * needs this.
 */
const DEV_AUTH_PREFIX = "#devauth=";

export function parseDevAuthFragment(hash: string): StoredAuthTokens | null {
  if (!hash.startsWith(DEV_AUTH_PREFIX)) {
    return null;
  }
  const body = hash.slice(DEV_AUTH_PREFIX.length);
  const sep = body.indexOf("|");
  if (sep === -1) {
    return null;
  }
  let token: string;
  let refreshToken: string;
  try {
    token = decodeURIComponent(body.slice(0, sep));
    refreshToken = decodeURIComponent(body.slice(sep + 1));
  } catch {
    return null;
  }
  if (token.length === 0 || refreshToken.length === 0) {
    return null;
  }
  return { token, refreshToken };
}
