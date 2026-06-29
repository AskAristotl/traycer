import { describe, expect, it, vi } from "vitest";
import {
  WebRunnerHost,
  parseAuthCallback,
  type WebEnv,
} from "../web-runner-host";
import { createWebSecureStorage, createWebTokenStore } from "../web-storage";

function fakeStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

function makeEnv(overrides: Partial<WebEnv>): WebEnv & {
  navigated: string[];
  openedTabs: string[];
  cleaned: number;
  fireResume(): void;
} {
  const navigated: string[] = [];
  const openedTabs: string[] = [];
  const resumeHandlers = new Set<() => void>();
  let cleaned = 0;
  return {
    initialSearch: "",
    navigate: (url) => navigated.push(url),
    openTab: (url) => openedTabs.push(url),
    cleanAuthParamsFromUrl: () => {
      cleaned += 1;
    },
    onResume: (handler) => {
      resumeHandlers.add(handler);
      return () => resumeHandlers.delete(handler);
    },
    navigated,
    openedTabs,
    get cleaned() {
      return cleaned;
    },
    fireResume: () => {
      for (const h of resumeHandlers) h();
    },
    ...overrides,
  };
}

function makeHost(env: WebEnv) {
  return new WebRunnerHost({
    signInUrl: "https://platform.traycer.ai/?redirect_uri=x",
    authnBaseUrl: "https://gw.ts.net/authn",
    signInBaseUrl: "https://platform.traycer.ai",
    secureStorage: createWebSecureStorage(fakeStore()),
    tokenStore: createWebTokenStore(fakeStore()),
    env,
  });
}

describe("parseAuthCallback", () => {
  it("extracts a code", () => {
    expect(parseAuthCallback("?code=abc")).toEqual({ code: "abc" });
  });
  it("prefers an error over a code", () => {
    expect(parseAuthCallback("?error=denied&code=abc")).toEqual({
      error: "denied",
    });
  });
  it("returns null when neither is present", () => {
    expect(parseAuthCallback("?foo=bar")).toBeNull();
  });
});

describe("WebRunnerHost", () => {
  it("is a remote-only shell", () => {
    const host = makeHost(makeEnv({}));
    expect(host.hasLocalHost).toBe(false);
  });

  it("emits a single null local-host snapshot", () => {
    const host = makeHost(makeEnv({}));
    const snapshots: Array<unknown> = [];
    host.onLocalHostChange((s) => snapshots.push(s));
    expect(snapshots).toEqual([null]);
  });

  it("navigates same-tab for the sign-in URL and new-tab otherwise", async () => {
    const env = makeEnv({});
    const host = makeHost(env);
    await host.openExternalLink("https://platform.traycer.ai/login?x=1");
    await host.openExternalLink("https://github.com/traycerai/traycer");
    expect(env.navigated).toEqual(["https://platform.traycer.ai/login?x=1"]);
    expect(env.openedTabs).toEqual(["https://github.com/traycerai/traycer"]);
  });

  it("captures an OAuth redirect landing and scrubs the URL", async () => {
    const env = makeEnv({ initialSearch: "?code=xyz" });
    const host = makeHost(env);
    expect(env.cleaned).toBe(1);
    const received = await new Promise<unknown>((resolve) => {
      host.onAuthCallback((r) => resolve(r));
    });
    expect(received).toEqual({ code: "xyz" });
  });

  it("does not scrub the URL when there is no callback", () => {
    const env = makeEnv({ initialSearch: "?foo=bar" });
    makeHost(env);
    expect(env.cleaned).toBe(0);
  });

  it("fires onSystemResumed handlers on resume and stops after dispose", () => {
    const env = makeEnv({});
    const host = makeHost(env);
    const handler = vi.fn();
    const sub = host.onSystemResumed(handler);
    env.fireResume();
    expect(handler).toHaveBeenCalledTimes(1);
    sub.dispose();
    env.fireResume();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("exposes always-present no-op capabilities", async () => {
    const host = makeHost(makeEnv({}));
    expect(await host.getRegisteredUrlSchemes()).toEqual([]);
    expect(await host.requestMicrophoneAccess()).toBe("granted");
    expect(await host.workspaceFolders.pickFolders()).toEqual([]);
    expect(host.service).toBeNull();
    expect(host.traycerCli).toBeNull();
    expect(host.hostManagement).toBeNull();
  });
});
