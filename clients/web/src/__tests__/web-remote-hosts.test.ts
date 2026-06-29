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
      bootstrapHosts: [],
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
      bootstrapHosts: [],
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
  it("returns the bootstrap bridge's discovered hosts", async () => {
    const hosts = [
      { tailnetName: "studio.ts.net", hostId: "h1", version: "1.0.0" },
      { tailnetName: "laptop.ts.net", hostId: "h2", version: "1.0.0" },
    ];
    const bridge = createWebRemoteHostsBridge({
      bootstrapHosts: ["studio.ts.net"],
      fetchFn: fetchStub(
        { "https://studio.ts.net:8443/discover": { hosts } },
        { failUrls: [] },
      ),
    });
    expect(await bridge.enumerate()).toEqual(hosts);
  });

  it("dedupes hosts discovered from multiple bootstraps by hostId", async () => {
    const bridge = createWebRemoteHostsBridge({
      bootstrapHosts: ["a.ts.net", "b.ts.net"],
      fetchFn: fetchStub(
        {
          "https://a.ts.net:8443/discover": {
            hosts: [{ tailnetName: "a.ts.net", hostId: "h1", version: "1.0.0" }],
          },
          "https://b.ts.net:8443/discover": {
            hosts: [
              { tailnetName: "a.ts.net", hostId: "h1", version: "1.0.0" },
              { tailnetName: "b.ts.net", hostId: "h2", version: "1.0.0" },
            ],
          },
        },
        { failUrls: [] },
      ),
    });
    const result = await bridge.enumerate();
    expect(result.map((h) => h.hostId)).toEqual(["h1", "h2"]);
  });

  it("degrades to the reachable bootstraps when one is down", async () => {
    const bridge = createWebRemoteHostsBridge({
      bootstrapHosts: ["up.ts.net", "down.ts.net"],
      fetchFn: fetchStub(
        {
          "https://up.ts.net:8443/discover": {
            hosts: [{ tailnetName: "up.ts.net", hostId: "h1", version: "1.0.0" }],
          },
        },
        { failUrls: ["https://down.ts.net:8443/discover"] },
      ),
    });
    expect((await bridge.enumerate()).map((h) => h.hostId)).toEqual(["h1"]);
  });
});
