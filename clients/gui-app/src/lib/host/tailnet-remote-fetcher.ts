import type { HostDirectoryEntry } from "@traycer-clients/shared/host-client/host-directory";
import type {
  RemoteHostFetcher,
} from "@traycer-clients/shared/host-client/remote-fetcher";
import type {
  RemoteHostProbe,
  DiscoveredRemoteHost,
} from "@traycer-clients/shared/host-client/tailnet-remote";
import { toRemoteDirectoryEntry } from "@traycer-clients/shared/host-client/tailnet-remote";
import type { ManualRemoteHost } from "@/stores/remote-hosts/remote-hosts-store";

export interface TailnetRemoteFetcherDeps {
  readonly probe: (input: {
    readonly tailnetName: string;
  }) => Promise<RemoteHostProbe>;
  readonly enumerate: () => Promise<readonly DiscoveredRemoteHost[]>;
  readonly readState: () => {
    readonly manualHosts: ReadonlyArray<ManualRemoteHost>;
    readonly disabledDiscovered: Readonly<Record<string, boolean>>;
  };
}

/**
 * Compose a `RemoteHostFetcher` from the preload bridge's `remoteHosts` surface
 * and the gui-app persisted remote-hosts store.
 *
 * Merge rules (applied in order):
 * 1. Enumerate discovered tailnet hosts via `enumerate()`.
 * 2. Drop any discovered host whose hostId is in `disabledDiscovered`.
 * 3. Merge with `manualHosts`; when a manual host shares a hostId with a
 *    discovered host the manual label wins (de-duplicated by hostId).
 * 4. Probe each manual host that was NOT already discovered to determine
 *    reachability / availability.
 *
 * The fetcher never throws — any error returns [].
 */
export function createTailnetRemoteFetcher(
  deps: TailnetRemoteFetcherDeps,
): RemoteHostFetcher {
  return async (): Promise<readonly HostDirectoryEntry[]> => {
    try {
      const { manualHosts, disabledDiscovered } = deps.readState();

      // 1. Discover via enumerate
      let discovered: readonly DiscoveredRemoteHost[] = [];
      try {
        discovered = await deps.enumerate();
      } catch {
        // enumerate failure → treat as empty discovery, still serve manual hosts
        discovered = [];
      }

      // 2. Drop disabled discovered hosts
      const enabledDiscovered = discovered.filter(
        (d) => !disabledDiscovered[d.hostId],
      );

      // Build a Set of discovered hostIds so we can skip re-probing them
      const discoveredIds = new Set(enabledDiscovered.map((d) => d.hostId));

      // 3. Build entries for enabled discovered hosts
      const discoveredEntries: HostDirectoryEntry[] = enabledDiscovered.map(
        (d) => {
          // Check if a manual host overrides the label for this hostId
          const manualOverride = manualHosts.find((m) => m.hostId === d.hostId);
          return toRemoteDirectoryEntry({
            tailnetName: d.tailnetName,
            hostId: d.hostId,
            label: manualOverride !== undefined ? manualOverride.label : d.tailnetName,
            version: d.version,
            status: "available",
          });
        },
      );

      // 4. Probe manual hosts that were NOT in the discovered set
      const manualOnlyHosts = manualHosts.filter(
        (m) => !discoveredIds.has(m.hostId),
      );

      const manualEntries = await Promise.all(
        manualOnlyHosts.map(async (m): Promise<HostDirectoryEntry> => {
          try {
            const result = await deps.probe({ tailnetName: m.tailnetName });
            return toRemoteDirectoryEntry({
              tailnetName: m.tailnetName,
              hostId: m.hostId,
              label: m.label,
              version: result.version,
              status: result.reachable ? "available" : "unavailable",
            });
          } catch {
            return toRemoteDirectoryEntry({
              tailnetName: m.tailnetName,
              hostId: m.hostId,
              label: m.label,
              version: null,
              status: "unavailable",
            });
          }
        }),
      );

      return [...discoveredEntries, ...manualEntries];
    } catch {
      return [];
    }
  };
}
