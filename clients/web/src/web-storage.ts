import type {
  ISecureStorage,
  ITokenStore,
  StoredAuthTokens,
} from "@traycer-clients/shared/platform/runner-host";

/**
 * Browser-backed `ISecureStorage` + `ITokenStore` for the web/PWA shell.
 *
 * The tailnet-gated personal-tool threat model (the only origin that can reach
 * these tokens is the user's own tailnet-served PWA, behind Tailscale device
 * identity + ACLs) makes `localStorage` acceptable here. The Capacitor shell
 * replaces both with the native keychain via `MobileRunnerHost`; this module is
 * the PWA-spike implementation only.
 */

const TOKEN_STORE_KEY = "traycer.tokens";

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveStore(store: KeyValueStore | undefined): KeyValueStore {
  if (store !== undefined) {
    return store;
  }
  if (typeof localStorage === "undefined") {
    throw new Error("localStorage is unavailable in this environment");
  }
  return localStorage;
}

export function createWebSecureStorage(
  store: KeyValueStore | undefined,
): ISecureStorage {
  const backing = resolveStore(store);
  return {
    get: async (key: string): Promise<string | null> => backing.getItem(key),
    set: async (key: string, value: string): Promise<void> => {
      backing.setItem(key, value);
    },
    delete: async (key: string): Promise<void> => {
      backing.removeItem(key);
    },
  };
}

export function createWebTokenStore(
  store: KeyValueStore | undefined,
): ITokenStore {
  const backing = resolveStore(store);
  return {
    get: async (): Promise<StoredAuthTokens | null> => {
      const raw = backing.getItem(TOKEN_STORE_KEY);
      if (raw === null) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw) as Partial<StoredAuthTokens>;
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
      backing.setItem(TOKEN_STORE_KEY, JSON.stringify(tokens));
    },
    delete: async (): Promise<void> => {
      backing.removeItem(TOKEN_STORE_KEY);
    },
  };
}
