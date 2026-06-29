/**
 * Pure tailnet host-discovery core, shared between the desktop's electron-main
 * probe and the `traycer-cli` tailnet bridge's `/discover` endpoint.
 *
 * The logic is IO-free: callers inject `tailscaleStatusJson` (a `tailscale
 * status --json` invocation) and `probe` (a `/whoami` reachability check), so
 * the same parsing + filtering runs identically under Node (electron-main),
 * Bun/Node (the CLI bridge), and in tests. The electron-main copy in
 * `clients/desktop/src/electron-main/host/remote-probe.ts` is retained only
 * because that process is CommonJS-isolated and cannot import this module; it
 * must stay structurally identical to this core.
 */
import type {
  DiscoveredRemoteHost,
  RemoteHostProbe,
  TailnetWhoami,
} from "./tailnet-remote";
import { normalizeTailnetName } from "./tailnet-remote";

/**
 * Testable core: resolve a `RemoteHostProbe` by calling the injected
 * `getWhoami`. Success → `{ reachable: true, hostId, version }`; any throw →
 * the unreachable sentinel.
 */
export async function probeRemoteHostWith(
  input: { readonly tailnetName: string },
  deps: {
    readonly getWhoami: (tailnetName: string) => Promise<TailnetWhoami>;
  },
): Promise<RemoteHostProbe> {
  try {
    const { hostId, version } = await deps.getWhoami(input.tailnetName);
    return { reachable: true, hostId, version };
  } catch {
    return { reachable: false, hostId: null, version: null };
  }
}

/**
 * Testable core: parse a `tailscale status --json` payload, probe each online
 * peer in parallel, and return only those reachable with a non-null `hostId`.
 * Never throws — an unparseable/empty status yields `[]`.
 */
export async function enumerateTailnetHostsWith(deps: {
  readonly tailscaleStatusJson: () => Promise<string>;
  readonly probe: (tailnetName: string) => Promise<RemoteHostProbe>;
}): Promise<readonly DiscoveredRemoteHost[]> {
  let raw: string;
  try {
    raw = await deps.tailscaleStatusJson();
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (parsed === null || typeof parsed !== "object") {
    return [];
  }

  const peer = (parsed as Record<string, unknown>).Peer;
  if (peer === null || typeof peer !== "object") {
    return [];
  }

  const onlineNames: string[] = Object.values(
    peer as Record<string, unknown>,
  ).flatMap((p) => {
    if (p === null || typeof p !== "object") {
      return [];
    }
    const entry = p as Record<string, unknown>;
    if (entry.Online !== true) {
      return [];
    }
    const dnsName = entry.DNSName;
    if (typeof dnsName !== "string" || dnsName === "") {
      return [];
    }
    return [normalizeTailnetName(dnsName)];
  });

  const probeResults = await Promise.all(
    onlineNames.map(async (tailnetName) => ({
      tailnetName,
      probe: await deps.probe(tailnetName),
    })),
  );

  return probeResults.flatMap(({ tailnetName, probe }) => {
    if (!probe.reachable || probe.hostId === null || probe.version === null) {
      return [];
    }
    const discovered: DiscoveredRemoteHost = {
      tailnetName,
      hostId: probe.hostId,
      version: probe.version,
    };
    return [discovered];
  });
}
