import { describe, expect, it } from "vitest";
import { normalizeTailnetName, toRemoteDirectoryEntry } from "@traycer-clients/shared/host-client/tailnet-remote";

describe("tailnet-remote", () => {
  it("normalizes a magicdns name", () => {
    expect(normalizeTailnetName("  Studio.Tailnet.ts.net.  ")).toBe("studio.tailnet.ts.net");
  });
  it("builds a wss /rpc remote entry with the real hostId", () => {
    const entry = toRemoteDirectoryEntry({
      tailnetName: "studio.tailnet.ts.net",
      hostId: "host-abc",
      label: "Mac Studio",
      version: "1.2.3",
      status: "available",
    });
    expect(entry).toEqual({
      hostId: "host-abc",
      label: "Mac Studio",
      kind: "remote",
      websocketUrl: "wss://studio.tailnet.ts.net:8443/rpc",
      version: "1.2.3",
      status: "available",
    });
  });
});
