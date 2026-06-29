/**
 * Web/PWA shell configuration, resolved from Vite `VITE_*` env at build time
 * with dev-friendly fallbacks. The Capacitor shell supplies its own values
 * (real `authn.traycer.ai` over native HTTP, a `traycer://` deep-link redirect)
 * and does not use this module.
 */
export interface WebConfig {
  /**
   * Base URL the shared auth HTTP helpers hit. On the PWA spike this is the
   * SAME-ORIGIN `/authn` reverse proxy so the browser never makes a
   * cross-origin request to `authn.traycer.ai` (whose CORS is pinned to
   * `platform.traycer.ai`).
   */
  readonly authnBaseUrl: string;
  /** Cloud sign-in page base (top-level navigation; not CORS-gated). */
  readonly signInBaseUrl: string;
  /** OAuth redirect target the cloud sends the browser back to. */
  readonly authRedirectUri: string;
  /** Tailnet bridge names to bootstrap host discovery (`/discover`) from. */
  readonly bootstrapHosts: readonly string[];
}

function readEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string {
  const value = env[key];
  return value === undefined || value.length === 0 ? fallback : value;
}

export function loadWebConfig(
  env: Record<string, string | undefined>,
  origin: string,
): WebConfig {
  return {
    authnBaseUrl: readEnv(env, "VITE_AUTHN_PROXY_BASE", `${origin}/authn`),
    signInBaseUrl: readEnv(
      env,
      "VITE_SIGN_IN_BASE_URL",
      "https://platform.traycer.ai",
    ),
    authRedirectUri: readEnv(env, "VITE_AUTH_REDIRECT_URI", `${origin}/`),
    bootstrapHosts: readEnv(env, "VITE_BOOTSTRAP_HOSTS", "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}

/**
 * Compose the sign-in URL: `${base}?redirect_uri=…`. The gui-app auth service
 * appends the PKCE `code_challenge`. Mirrors `composeDesktopSignInUrl`.
 */
export function composeWebSignInUrl(
  signInBaseUrl: string,
  redirectUri: string,
): string {
  const separator = signInBaseUrl.includes("?") ? "&" : "?";
  return `${signInBaseUrl}${separator}redirect_uri=${encodeURIComponent(
    redirectUri,
  )}`;
}
