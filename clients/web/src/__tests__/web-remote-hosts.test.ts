import { describe, expect, it } from "vitest";
import {
  createWebRemoteHostsBridge,
  type FetchFn,
} from "../web-remote-hosts";

function fetchStub(
  routes: Record<string, unknown>,
  opts: { failUrls: readonly string[] },
): FetchFn {
  return async (input: string) => {
    if (opts.failUrls.includes(input)) {
      throw new Error("network error");
    }
    if (!(input in routes)) {
      return { ok: false, json: async () => ({}) };
    }
    return { ok: true, json: async () => routes[input] };
  };
}

describe("createWebRemoteHostsBridge.probe", () => {
  it("maps a good /whoami to reachable", async () => {
    const bridge = createWebRemoteHostsBridge({
      discoverUrl: "/discover",
      fetchFn: fetchStub(
        {
          "https://studio.ts.net:8443/whoami": {
            hostId: "h1",
            version: "1.0.0",
          },
        },
        { failUrls: [] },
      ),
    });
    expect(await bridge.probe({ tailnetName: "studio.ts.net" })).toEqual({
      reachable: true,
      hostId: "h1",
      version: "1.0.0",
    });
  });

  it("maps a non-ok /whoami to unreachable", async () => {
    const bridge = createWebRemoteHostsBridge({
      discoverUrl: "/discover",
      fetchFn: fetchStub({}, { failUrls: [] }),
    });
    expect(await bridge.probe({ tailnetName: "down.ts.net" })).toEqual({
      reachable: false,
      hostId: null,
      version: null,
    });
  });
});

describe("createWebRemoteHostsBridge.enumerate", () => {
  it("returns the discover endpoint's hosts in one fetch", async () => {
    const hosts = [
      { tailnetName: "studio.ts.net", hostId: "h1", version: "1.0.0" },
      { tailnetName: "laptop.ts.net", hostId: "h2", version: "1.0.0" },
    ];
    const bridge = createWebRemoteHostsBridge({
      discoverUrl: "https://gw.ts.net/discover",
      fetchFn: fetchStub(
        { "https://gw.ts.net/discover": { hosts } },
        { failUrls: [] },
      ),
    });
    expect(await bridge.enumerate()).toEqual(hosts);
  });

  it("returns [] on a non-ok discover response", async () => {
    const bridge = createWebRemoteHostsBridge({
      discoverUrl: "https://gw.ts.net/discover",
      fetchFn: fetchStub({}, { failUrls: [] }),
    });
    expect(await bridge.enumerate()).toEqual([]);
  });

  it("returns [] when the discover fetch throws", async () => {
    const bridge = createWebRemoteHostsBridge({
      discoverUrl: "https://gw.ts.net/discover",
      fetchFn: fetchStub({}, { failUrls: ["https://gw.ts.net/discover"] }),
    });
    expect(await bridge.enumerate()).toEqual([]);
  });

  it("filters malformed host entries", async () => {
    const bridge = createWebRemoteHostsBridge({
      discoverUrl: "https://gw.ts.net/discover",
      fetchFn: fetchStub(
        {
          "https://gw.ts.net/discover": {
            hosts: [
              { tailnetName: "ok.ts.net", hostId: "h1", version: "1.0.0" },
              { tailnetName: "bad.ts.net" },
            ],
          },
        },
        { failUrls: [] },
      ),
    });
    expect((await bridge.enumerate()).map((h) => h.hostId)).toEqual(["h1"]);
  });
});
