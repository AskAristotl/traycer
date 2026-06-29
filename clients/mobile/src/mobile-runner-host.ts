import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Preferences } from "@capacitor/preferences";
import {
  WebRunnerHost,
  composeWebSignInUrl,
  parseAuthCallback,
  type WebEnv,
} from "@traycer-clients/web";
import type {
  ISecureStorage,
  ITokenStore,
  StoredAuthTokens,
} from "@traycer-clients/shared/platform/runner-host";

// Native HTTP (CapacitorHttp, enabled in capacitor.config) reaches authn
// directly with no CORS and no proxy — so the mobile shell points at the REAL
// authn origin, unlike the PWA spike's same-origin `/authn` proxy.
const REAL_AUTHN_BASE_URL = "https://authn.traycer.ai";
const SIGN_IN_BASE_URL = "https://platform.traycer.ai";
// Reuse the desktop's already-registered `traycer://` OAuth scheme so
// `platform.traycer.ai` accepts the redirect without a new allowlist entry.
const DEEP_LINK_REDIRECT_URI = "traycer://auth/callback";

const TOKEN_STORE_KEY = "traycer.tokens";

/**
 * NOTE: `@capacitor/preferences` is app-private storage (UserDefaults /
 * SharedPreferences), not the OS Keychain/Keystore. For the secure-store
 * hardening the spec calls for, swap these two factories onto a secure-storage
 * plugin (e.g. `@capacitor-community/secure-storage-plugin`); the `IRunnerHost`
 * contract is unchanged.
 */
function preferencesSecureStorage(): ISecureStorage {
  return {
    get: async (key: string): Promise<string | null> =>
      (await Preferences.get({ key })).value,
    set: async (key: string, value: string): Promise<void> => {
      await Preferences.set({ key, value });
    },
    delete: async (key: string): Promise<void> => {
      await Preferences.remove({ key });
    },
  };
}

function preferencesTokenStore(): ITokenStore {
  return {
    get: async (): Promise<StoredAuthTokens | null> => {
      const { value } = await Preferences.get({ key: TOKEN_STORE_KEY });
      if (value === null) {
        return null;
      }
      try {
        const parsed = JSON.parse(value) as Partial<StoredAuthTokens>;
        if (
          typeof parsed.token === "string" &&
          typeof parsed.refreshToken === "string"
        ) {
          return { token: parsed.token, refreshToken: parsed.refreshToken };
        }
        return null;
      } catch {
        return null;
      }
    },
    set: async (tokens: StoredAuthTokens): Promise<void> => {
      await Preferences.set({
        key: TOKEN_STORE_KEY,
        value: JSON.stringify(tokens),
      });
    },
    delete: async (): Promise<void> => {
      await Preferences.remove({ key: TOKEN_STORE_KEY });
    },
  };
}

/**
 * Native `WebEnv`: the sign-in URL opens in the system browser (so the
 * `traycer://` deep-link returns to the app), and resume is the Capacitor
 * `App` lifecycle event rather than `visibilitychange`.
 */
function nativeEnv(): WebEnv {
  return {
    // The deep-link code arrives via `appUrlOpen` (wired below), not the URL.
    initialSearch: "",
    navigate: (url: string): void => {
      void Browser.open({ url });
    },
    openTab: (url: string): void => {
      void Browser.open({ url });
    },
    cleanAuthParamsFromUrl: (): void => {
      // No address bar on native.
    },
    onResume: (handler: () => void): (() => void) => {
      const handle = App.addListener("resume", handler);
      return () => {
        void handle.then((listener) => listener.remove());
      };
    },
  };
}

/**
 * Build the Capacitor `IRunnerHost`: the same `WebRunnerHost` core wired with
 * native deps. Reuse over reimplementation — the only differences from the PWA
 * shell are the storage backend, the resume signal, the real (proxy-free) authn
 * base, and the deep-link OAuth callback.
 */
export function createMobileRunnerHost(): WebRunnerHost {
  const host = new WebRunnerHost({
    signInUrl: composeWebSignInUrl(SIGN_IN_BASE_URL, DEEP_LINK_REDIRECT_URI),
    authnBaseUrl: REAL_AUTHN_BASE_URL,
    signInBaseUrl: SIGN_IN_BASE_URL,
    secureStorage: preferencesSecureStorage(),
    tokenStore: preferencesTokenStore(),
    env: nativeEnv(),
    notificationApi: null,
  });

  // Deliver the OAuth callback delivered as a `traycer://auth/callback?code=…`
  // deep link to the in-memory auth controller (the PKCE verifier is still in
  // its memory; the app never unloaded).
  void App.addListener("appUrlOpen", (event: { url: string }) => {
    const queryIndex = event.url.indexOf("?");
    const search = queryIndex === -1 ? "" : event.url.slice(queryIndex);
    const result = parseAuthCallback(search);
    if (result !== null) {
      host.emitAuthCallback(result);
      void Browser.close();
    }
  });

  return host;
}
