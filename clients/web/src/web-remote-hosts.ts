import { probeRemoteHostWith } from "@traycer-clients/shared/host-client/tailnet-discovery";
import {
  TAILNET_BRIDGE_HTTPS_PORT,
  type DiscoveredRemoteHost,
  type RemoteHostProbe,
  type TailnetWhoami,
} from "@traycer-clients/shared/host-client/tailnet-remote";

/**
 * Web/PWA implementation of the host-directory `probe` + `enumerate` surface
 * the desktop installs from electron-main. There is no `tailscale` CLI on a
 * phone, so:
 *  - `probe` reads a single host's `/whoami` over HTTPS, and
 *  - `enumerate` bootstraps the whole tailnet from one (or more) known bridges'
 *    `/discover` endpoints.
 *
 * Both use `fetch`. On the PWA spike this depends on the bridge's
 * `Access-Control-Allow-Origin: *` (added alongside `/discover`); the Capacitor
 * `MobileRunnerHost` swaps the same calls onto native HTTP, where CORS does not
 * apply at all.
 */

export type FetchFn = (
  input: string,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

function bridgeBase(tailnetName: string): string {
  return `https://${tailnetName}:${TAILNET_BRIDGE_HTTPS_PORT}`;
}

function asTailnetWhoami(value: unknown): TailnetWhoami {
  if (value === null || typeof value !== "object") {
    throw new Error("/whoami did not return an object");
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.hostId !== "string" || typeof obj.version !== "string") {
    throw new Error("/whoami missing hostId or version");
  }
  return { hostId: obj.hostId, version: obj.version };
}

function asDiscoveredHosts(value: unknown): readonly DiscoveredRemoteHost[] {
  if (value === null || typeof value !== "object") {
    return [];
  }
  const hosts = (value as Record<string, unknown>).hosts;
  if (!Array.isArray(hosts)) {
    return [];
  }
  return hosts.flatMap((h): DiscoveredRemoteHost[] => {
    if (h === null || typeof h !== "object") {
      return [];
    }
    const entry = h as Record<string, unknown>;
    if (
      typeof entry.tailnetName !== "string" ||
      typeof entry.hostId !== "string" ||
      typeof entry.version !== "string"
    ) {
      return [];
    }
    return [
      {
        tailnetName: entry.tailnetName,
        hostId: entry.hostId,
        version: entry.version,
      },
    ];
  });
}

export interface WebRemoteHostsDeps {
  readonly fetchFn: FetchFn;
  /** Tailnet names of bridges to bootstrap discovery from. */
  readonly bootstrapHosts: readonly string[];
}

export interface WebRemoteHostsBridge {
  probe(input: { readonly tailnetName: string }): Promise<RemoteHostProbe>;
  enumerate(): Promise<readonly DiscoveredRemoteHost[]>;
}

export function createWebRemoteHostsBridge(
  deps: WebRemoteHostsDeps,
): WebRemoteHostsBridge {
  const getWhoami = async (tailnetName: string): Promise<TailnetWhoami> => {
    const res = await deps.fetchFn(`${bridgeBase(tailnetName)}/whoami`);
    if (!res.ok) {
      throw new Error(`/whoami returned a non-ok status`);
    }
    return asTailnetWhoami(await res.json());
  };

  const discoverFrom = async (
    tailnetName: string,
  ): Promise<readonly DiscoveredRemoteHost[]> => {
    try {
      const res = await deps.fetchFn(`${bridgeBase(tailnetName)}/discover`);
      if (!res.ok) {
        return [];
      }
      return asDiscoveredHosts(await res.json());
    } catch {
      return [];
    }
  };

  return {
    probe: (input) => probeRemoteHostWith(input, { getWhoami }),
    enumerate: async (): Promise<readonly DiscoveredRemoteHost[]> => {
      const lists = await Promise.all(deps.bootstrapHosts.map(discoverFrom));
      // Dedupe by hostId across bootstraps; first occurrence wins.
      const seen = new Set<string>();
      const merged: DiscoveredRemoteHost[] = [];
      for (const host of lists.flat()) {
        if (seen.has(host.hostId)) {
          continue;
        }
        seen.add(host.hostId);
        merged.push(host);
      }
      return merged;
    },
  };
}
