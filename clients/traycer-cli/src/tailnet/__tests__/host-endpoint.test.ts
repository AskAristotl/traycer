import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHostWsPort, readBridgeHostEndpoint } from "../host-endpoint";
import * as pidMetadataModule from "../../host/pid-metadata";

describe("parseHostWsPort", () => {
  it("extracts the port from a local host ws url", () => {
    expect(parseHostWsPort("ws://127.0.0.1:4917/rpc")).toBe(4917);
  });
  it("returns null for a url with no port", () => {
    expect(parseHostWsPort("ws://127.0.0.1/rpc")).toBeNull();
  });
  it("returns null for an unparseable url", () => {
    expect(parseHostWsPort("not a url")).toBeNull();
  });
});

describe("readBridgeHostEndpoint", () => {
  let readHostPidMetadataSpy: {
    mockRestore(): void;
    mockResolvedValue(value: { pid: number; hostId: string; version: string; websocketUrl: string; startedAt: string } | null): void;
  };

  beforeEach(() => {
    readHostPidMetadataSpy = vi.spyOn(
      pidMetadataModule,
      "readHostPidMetadata",
    );
  });

  afterEach(() => {
    readHostPidMetadataSpy.mockRestore();
  });

  it("returns null when readHostPidMetadata returns null", async () => {
    readHostPidMetadataSpy.mockResolvedValue(null);
    const result = await readBridgeHostEndpoint(undefined);
    expect(result).toBeNull();
  });
});
