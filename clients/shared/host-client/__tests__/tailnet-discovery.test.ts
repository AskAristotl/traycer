import { describe, expect, it } from "vitest";
import {
  probeRemoteHostWith,
  enumerateTailnetHostsWith,
} from "../tailnet-discovery";

describe("probeRemoteHostWith", () => {
  it("maps a good /whoami to reachable", async () => {
    const result = await probeRemoteHostWith(
      { tailnetName: "studio.ts.net" },
      { getWhoami: async () => ({ hostId: "h1", version: "1.0.0" }) },
    );
    expect(result).toEqual({ reachable: true, hostId: "h1", version: "1.0.0" });
  });

  it("maps a failure to unreachable", async () => {
    const result = await probeRemoteHostWith(
      { tailnetName: "studio.ts.net" },
      {
        getWhoami: async () => {
          throw new Error("nope");
        },
      },
    );
    expect(result).toEqual({ reachable: false, hostId: null, version: null });
  });
});

describe("enumerateTailnetHostsWith", () => {
  it("returns only online+reachable peers with a hostId", async () => {
    const fakeStatus = JSON.stringify({
      Peer: {
        "node-a": { Online: true, DNSName: "studio.ts.net." },
        "node-b": { Online: false, DNSName: "offline.ts.net." },
        "node-c": { Online: true, DNSName: "unreachable.ts.net." },
      },
    });

    const result = await enumerateTailnetHostsWith({
      tailscaleStatusJson: async () => fakeStatus,
      probe: async (tailnetName) =>
        tailnetName === "studio.ts.net"
          ? { reachable: true, hostId: "h1", version: "1.0.0" }
          : { reachable: false, hostId: null, version: null },
    });

    expect(result).toEqual([
      { tailnetName: "studio.ts.net", hostId: "h1", version: "1.0.0" },
    ]);
  });

  it("returns an empty array when tailscale status is unparseable", async () => {
    const result = await enumerateTailnetHostsWith({
      tailscaleStatusJson: async () => "not json",
      probe: async () => ({ reachable: true, hostId: "h1", version: "1.0.0" }),
    });
    expect(result).toEqual([]);
  });

  it("returns an empty array when the status subprocess throws", async () => {
    const result = await enumerateTailnetHostsWith({
      tailscaleStatusJson: async () => {
        throw new Error("tailscale not installed");
      },
      probe: async () => ({ reachable: true, hostId: "h1", version: "1.0.0" }),
    });
    expect(result).toEqual([]);
  });

  it("normalizes DNSName (strips trailing dot, lowercases)", async () => {
    const fakeStatus = JSON.stringify({
      Peer: { "node-a": { Online: true, DNSName: "MyHost.ts.net." } },
    });

    const probed: string[] = [];
    await enumerateTailnetHostsWith({
      tailscaleStatusJson: async () => fakeStatus,
      probe: async (tailnetName) => {
        probed.push(tailnetName);
        return { reachable: false, hostId: null, version: null };
      },
    });

    expect(probed).toEqual(["myhost.ts.net"]);
  });

  it("includes the local Self node when its bridge is reachable", async () => {
    const fakeStatus = JSON.stringify({
      Self: { Online: true, DNSName: "plato.ts.net." },
      Peer: { "node-a": { Online: true, DNSName: "laptop.ts.net." } },
    });
    const result = await enumerateTailnetHostsWith({
      tailscaleStatusJson: async () => fakeStatus,
      probe: async (tailnetName) =>
        tailnetName === "plato.ts.net"
          ? { reachable: true, hostId: "self", version: "1.0.0" }
          : { reachable: false, hostId: null, version: null },
    });
    // Self (plato) has a bridge; the peer doesn't.
    expect(result).toEqual([
      { tailnetName: "plato.ts.net", hostId: "self", version: "1.0.0" },
    ]);
  });

  it("drops Self when it has no reachable bridge", async () => {
    const fakeStatus = JSON.stringify({
      Self: { Online: true, DNSName: "gateway-only.ts.net." },
    });
    const result = await enumerateTailnetHostsWith({
      tailscaleStatusJson: async () => fakeStatus,
      probe: async () => ({ reachable: false, hostId: null, version: null }),
    });
    expect(result).toEqual([]);
  });

  it("does not probe the same name twice when Self also appears as a peer", async () => {
    const fakeStatus = JSON.stringify({
      Self: { Online: true, DNSName: "plato.ts.net." },
      Peer: { "node-a": { Online: true, DNSName: "plato.ts.net." } },
    });
    const probed: string[] = [];
    await enumerateTailnetHostsWith({
      tailscaleStatusJson: async () => fakeStatus,
      probe: async (tailnetName) => {
        probed.push(tailnetName);
        return { reachable: false, hostId: null, version: null };
      },
    });
    expect(probed).toEqual(["plato.ts.net"]);
  });
});
