import { describe, expect, it } from "vitest";
import { registerRemoteHostsIpc } from "../remote-hosts-ipc";
import type { RemoteHostProbe, DiscoveredRemoteHost } from "../../../ipc-contracts/remote-host-types";

/**
 * Tests for `registerRemoteHostsIpc`. We construct a minimal fake bridge that
 * captures registered handlers, then invoke them directly to assert:
 *
 *  1. Both channels are registered.
 *  2. The probe handler calls through and returns the result.
 *  3. The probe handler throws with a clear message on a bad payload.
 *  4. The enumerate handler calls through and returns the result.
 */

type InvokeHandler = (event: unknown, arg: unknown) => unknown | Promise<unknown>;

interface FakeBridge {
  readonly handlers: Map<string, InvokeHandler>;
  handleInvoke(channel: string, handler: InvokeHandler): void;
}

function makeFakeBridge(): FakeBridge {
  const handlers = new Map<string, InvokeHandler>();
  return {
    handlers,
    handleInvoke(channel, handler) {
      handlers.set(channel, handler);
    },
  };
}

function setup(
  probeResult: RemoteHostProbe,
  enumerateResult: readonly DiscoveredRemoteHost[],
): FakeBridge {
  const bridge = makeFakeBridge();
  registerRemoteHostsIpc(bridge, {
    probe: (_input) => Promise.resolve(probeResult),
    enumerate: () => Promise.resolve(enumerateResult),
  });
  return bridge;
}

describe("registerRemoteHostsIpc", () => {
  it("registers both IPC channels", () => {
    const bridge = setup({ reachable: false, hostId: null, version: null }, []);
    expect(bridge.handlers.has("runnerHost:remoteHosts:probe")).toBe(true);
    expect(bridge.handlers.has("runnerHost:remoteHosts:enumerate")).toBe(true);
  });

  it("probe handler returns the probe result for a valid payload", async () => {
    const expected: RemoteHostProbe = {
      reachable: true,
      hostId: "host-abc",
      version: "1.2.3",
    };
    const bridge = setup(expected, []);

    const handler = bridge.handlers.get("runnerHost:remoteHosts:probe");
    expect(handler).toBeDefined();

    const result = await (handler as InvokeHandler)(null, { tailnetName: "my-host.ts.net" });
    expect(result).toEqual(expected);
  });

  it("probe handler throws when payload is null", async () => {
    const bridge = setup({ reachable: false, hostId: null, version: null }, []);
    const handler = bridge.handlers.get("runnerHost:remoteHosts:probe") as InvokeHandler;
    await expect(() => handler(null, null)).rejects.toThrow(
      "remoteHosts.probe requires { tailnetName }",
    );
  });

  it("probe handler throws when payload is not an object", async () => {
    const bridge = setup({ reachable: false, hostId: null, version: null }, []);
    const handler = bridge.handlers.get("runnerHost:remoteHosts:probe") as InvokeHandler;
    await expect(() => handler(null, "bad")).rejects.toThrow(
      "remoteHosts.probe requires { tailnetName }",
    );
  });

  it("probe handler throws when tailnetName is empty", async () => {
    const bridge = setup({ reachable: false, hostId: null, version: null }, []);
    const handler = bridge.handlers.get("runnerHost:remoteHosts:probe") as InvokeHandler;
    await expect(() => handler(null, { tailnetName: "" })).rejects.toThrow(
      "remoteHosts.probe requires a non-empty tailnetName",
    );
  });

  it("probe handler throws when tailnetName is not a string", async () => {
    const bridge = setup({ reachable: false, hostId: null, version: null }, []);
    const handler = bridge.handlers.get("runnerHost:remoteHosts:probe") as InvokeHandler;
    await expect(() => handler(null, { tailnetName: 42 })).rejects.toThrow(
      "remoteHosts.probe requires a non-empty tailnetName",
    );
  });

  it("enumerate handler returns the discovered hosts", async () => {
    const discovered: readonly DiscoveredRemoteHost[] = [
      { tailnetName: "peer.ts.net", hostId: "h1", version: "2.0.0" },
    ];
    const bridge = setup({ reachable: false, hostId: null, version: null }, discovered);
    const handler = bridge.handlers.get("runnerHost:remoteHosts:enumerate") as InvokeHandler;
    const result = await handler(null, undefined);
    expect(result).toEqual(discovered);
  });
});
