import { describe, expect, it } from "vitest";
import {
  probeRemoteHostWith,
  enumerateTailnetHostsWith,
} from "../remote-probe";

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
        "node-a": {
          Online: true,
          DNSName: "studio.ts.net.",
        },
        "node-b": {
          Online: false,
          DNSName: "offline.ts.net.",
        },
        "node-c": {
          Online: true,
          DNSName: "unreachable.ts.net.",
        },
      },
    });

    const result = await enumerateTailnetHostsWith({
      tailscaleStatusJson: async () => fakeStatus,
      probe: async (tailnetName) => {
        if (tailnetName === "studio.ts.net") {
          return { reachable: true, hostId: "h1", version: "1.0.0" };
        }
        return { reachable: false, hostId: null, version: null };
      },
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

  it("strips trailing dots from DNSName", async () => {
    const fakeStatus = JSON.stringify({
      Peer: {
        "node-a": { Online: true, DNSName: "myhost.ts.net." },
      },
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
});
