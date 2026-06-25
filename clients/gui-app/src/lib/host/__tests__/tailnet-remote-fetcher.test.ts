import { describe, expect, it } from "vitest";
import type { RemoteHostProbe, DiscoveredRemoteHost } from "@traycer-clients/shared/host-client/tailnet-remote";
import type { ManualRemoteHost } from "@/stores/remote-hosts/remote-hosts-store";
import { createTailnetRemoteFetcher } from "@/lib/host/tailnet-remote-fetcher";

type ProbeFn = (input: { readonly tailnetName: string }) => Promise<RemoteHostProbe>;
type EnumerateFn = () => Promise<readonly DiscoveredRemoteHost[]>;

interface ReadStateResult {
  readonly manualHosts: ReadonlyArray<ManualRemoteHost>;
  readonly disabledDiscovered: Readonly<Record<string, boolean>>;
}

type ReadStateFn = () => ReadStateResult;

function makeFetcher(
  probe: ProbeFn,
  enumerate: EnumerateFn,
  readState: ReadStateFn,
) {
  return createTailnetRemoteFetcher({ probe, enumerate, readState });
}

const DISCOVERED_HOST: DiscoveredRemoteHost = {
  tailnetName: "studio.tailnet.ts.net",
  hostId: "host-abc",
  version: "1.2.3",
};

const MANUAL_HOST: ManualRemoteHost = {
  tailnetName: "macbook.tailnet.ts.net",
  hostId: "host-xyz",
  label: "My MacBook",
  addedAt: 1_000_000,
};

describe("createTailnetRemoteFetcher", () => {
  it("returns discovered hosts merged with manual hosts", async () => {
    const probe: ProbeFn = ({ tailnetName }) =>
      Promise.resolve({
        reachable: true,
        hostId: tailnetName === "studio.tailnet.ts.net" ? "host-abc" : null,
        version: "1.2.3",
      });
    const enumerate: EnumerateFn = () => Promise.resolve([DISCOVERED_HOST]);
    const readState: ReadStateFn = () => ({
      manualHosts: [MANUAL_HOST],
      disabledDiscovered: {},
    });

    const fetcher = makeFetcher(probe, enumerate, readState);
    const entries = await fetcher();

    // Expect both discovered and manual to appear
    expect(entries.length).toBe(2);
    const ids = entries.map((e) => e.hostId);
    expect(ids).toContain("host-abc");
    expect(ids).toContain("host-xyz");
  });

  it("manual label wins over discovered when hostId is the same", async () => {
    const sharedHost: DiscoveredRemoteHost = {
      tailnetName: "studio.tailnet.ts.net",
      hostId: "host-shared",
      version: "1.2.3",
    };
    const manualOverride: ManualRemoteHost = {
      tailnetName: "studio.tailnet.ts.net",
      hostId: "host-shared",
      label: "My Custom Label",
      addedAt: 1_000_000,
    };

    const enumerate: EnumerateFn = () => Promise.resolve([sharedHost]);
    const probe: ProbeFn = () =>
      Promise.resolve({ reachable: true, hostId: "host-shared", version: "1.2.3" });
    const readState: ReadStateFn = () => ({
      manualHosts: [manualOverride],
      disabledDiscovered: {},
    });

    const fetcher = makeFetcher(probe, enumerate, readState);
    const entries = await fetcher();

    expect(entries.length).toBe(1);
    expect(entries[0].hostId).toBe("host-shared");
    expect(entries[0].label).toBe("My Custom Label");
  });

  it("drops a discovered hostId match from a different tailnet name", async () => {
    const spoofedDiscovery: DiscoveredRemoteHost = {
      tailnetName: "attacker.tailnet.ts.net",
      hostId: "host-shared",
      version: "1.2.3",
    };
    const trustedManual: ManualRemoteHost = {
      tailnetName: "studio.tailnet.ts.net",
      hostId: "host-shared",
      label: "Trusted Studio",
      addedAt: 1_000_000,
    };

    const probed: string[] = [];
    const enumerate: EnumerateFn = () => Promise.resolve([spoofedDiscovery]);
    const probe: ProbeFn = ({ tailnetName }) => {
      probed.push(tailnetName);
      return Promise.resolve({
        reachable: true,
        hostId: "host-shared",
        version: "1.2.3",
      });
    };
    const readState: ReadStateFn = () => ({
      manualHosts: [trustedManual],
      disabledDiscovered: {},
    });

    const fetcher = makeFetcher(probe, enumerate, readState);
    const entries = await fetcher();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        hostId: "host-shared",
        label: "Trusted Studio",
        websocketUrl: "wss://studio.tailnet.ts.net:8443/rpc",
      }),
    );
    expect(probed).toEqual(["studio.tailnet.ts.net"]);
  });

  it("de-duplicates by hostId (no duplicate entries)", async () => {
    const sharedHost: DiscoveredRemoteHost = {
      tailnetName: "studio.tailnet.ts.net",
      hostId: "host-dup",
      version: "1.2.3",
    };
    const manualSame: ManualRemoteHost = {
      tailnetName: "studio.tailnet.ts.net",
      hostId: "host-dup",
      label: "Deduplicated",
      addedAt: 1_000_000,
    };

    const enumerate: EnumerateFn = () => Promise.resolve([sharedHost]);
    const probe: ProbeFn = () =>
      Promise.resolve({ reachable: true, hostId: "host-dup", version: "1.2.3" });
    const readState: ReadStateFn = () => ({
      manualHosts: [manualSame],
      disabledDiscovered: {},
    });

    const fetcher = makeFetcher(probe, enumerate, readState);
    const entries = await fetcher();

    expect(entries.length).toBe(1);
  });

  it("drops discovered entries that are disabled", async () => {
    const enumerate: EnumerateFn = () => Promise.resolve([DISCOVERED_HOST]);
    const probe: ProbeFn = () =>
      Promise.resolve({ reachable: true, hostId: "host-abc", version: "1.2.3" });
    const readState: ReadStateFn = () => ({
      manualHosts: [],
      disabledDiscovered: { "host-abc": true },
    });

    const fetcher = makeFetcher(probe, enumerate, readState);
    const entries = await fetcher();

    expect(entries.length).toBe(0);
  });

  it("returns [] when enumerate throws", async () => {
    const enumerate: EnumerateFn = () => Promise.reject(new Error("network failure"));
    const probe: ProbeFn = () =>
      Promise.resolve({ reachable: false, hostId: null, version: null });
    const readState: ReadStateFn = () => ({
      manualHosts: [],
      disabledDiscovered: {},
    });

    const fetcher = makeFetcher(probe, enumerate, readState);
    const entries = await fetcher();

    expect(entries).toEqual([]);
  });

  it("manual-only hosts still appear when enumerate returns empty", async () => {
    const enumerate: EnumerateFn = () => Promise.resolve([]);
    const probe: ProbeFn = () =>
      Promise.resolve({ reachable: true, hostId: "host-xyz", version: "1.0.0" });
    const readState: ReadStateFn = () => ({
      manualHosts: [MANUAL_HOST],
      disabledDiscovered: {},
    });

    const fetcher = makeFetcher(probe, enumerate, readState);
    const entries = await fetcher();

    expect(entries.length).toBe(1);
    expect(entries[0].hostId).toBe("host-xyz");
    expect(entries[0].label).toBe("My MacBook");
  });

  it("manual host that fails probe still appears as unavailable", async () => {
    const enumerate: EnumerateFn = () => Promise.resolve([]);
    const probe: ProbeFn = () => Promise.reject(new Error("probe failed"));
    const readState: ReadStateFn = () => ({
      manualHosts: [MANUAL_HOST],
      disabledDiscovered: {},
    });

    const fetcher = makeFetcher(probe, enumerate, readState);
    const entries = await fetcher();

    expect(entries.length).toBe(1);
    expect(entries[0].hostId).toBe("host-xyz");
    expect(entries[0].status).toBe("unavailable");
  });

  it("manual hosts still appear when enumerate throws", async () => {
    const enumerate: EnumerateFn = () => Promise.reject(new Error("network failure"));
    const probe: ProbeFn = () =>
      Promise.resolve({ reachable: true, hostId: "host-xyz", version: "1.0.0" });
    const readState: ReadStateFn = () => ({
      manualHosts: [MANUAL_HOST],
      disabledDiscovered: {},
    });

    const fetcher = makeFetcher(probe, enumerate, readState);
    const entries = await fetcher();

    expect(entries.length).toBe(1);
    expect(entries[0].hostId).toBe("host-xyz");
    expect(entries[0].label).toBe("My MacBook");
  });
});
