import { describe, expect, it, vi } from "vitest";
import type { AuthCallbackResult } from "@traycer-clients/shared/platform/runner-host";

// Capture the registered Capacitor listeners + a fake Preferences backing store
// so the native wiring can be exercised without a device.
const appListeners = new Map<string, (event: unknown) => void>();
const prefs = new Map<string, string>();

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (event: string, cb: (e: unknown) => void) => {
      appListeners.set(event, cb);
      return Promise.resolve({ remove: () => undefined });
    },
  },
}));
vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
  },
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: ({ key }: { key: string }) =>
      Promise.resolve({ value: prefs.has(key) ? (prefs.get(key) as string) : null }),
    set: ({ key, value }: { key: string; value: string }) => {
      prefs.set(key, value);
      return Promise.resolve();
    },
    remove: ({ key }: { key: string }) => {
      prefs.delete(key);
      return Promise.resolve();
    },
  },
}));

const { createMobileRunnerHost } = await import("../mobile-runner-host");

describe("createMobileRunnerHost", () => {
  it("is a remote-only shell pointed at the real authn origin (native HTTP, no proxy)", () => {
    const host = createMobileRunnerHost();
    expect(host.hasLocalHost).toBe(false);
    expect(host.authnBaseUrl).toBe("https://authn.traycer.ai");
  });

  it("delivers a traycer:// deep-link OAuth code to onAuthCallback", async () => {
    const host = createMobileRunnerHost();
    const received = new Promise<AuthCallbackResult>((resolve) => {
      host.onAuthCallback((r) => resolve(r));
    });
    const handler = appListeners.get("appUrlOpen");
    expect(handler).toBeDefined();
    handler?.({ url: "traycer://auth/callback?code=ABC123" });
    expect(await received).toEqual({ code: "ABC123" });
  });

  it("round-trips the token pair through Preferences-backed storage", async () => {
    const host = createMobileRunnerHost();
    await host.tokenStore.set({ token: "t1", refreshToken: "r1" });
    expect(await host.tokenStore.get()).toEqual({ token: "t1", refreshToken: "r1" });
    await host.tokenStore.delete();
    expect(await host.tokenStore.get()).toBeNull();
  });
});
