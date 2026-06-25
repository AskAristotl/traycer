/**
 * Shared Tailnet remote host types and URL builders.
 *
 * Exports the Interface Contract types for remote host discovery and addressing:
 * - TailnetWhoami: /whoami response from the bridge HTTP server
 * - RemoteHostProbe: reachability check result
 * - DiscoveredRemoteHost: a remote host found on the tailnet
 *
 * Also provides URL construction and name normalization for Tailscale MagicDNS names.
 */

import type { HostAvailability, HostDirectoryEntry } from "./host-directory";

export const TAILNET_BRIDGE_HTTPS_PORT = 8443;

export interface TailnetWhoami {
  readonly hostId: string;
  readonly version: string;
}

export interface RemoteHostProbe {
  readonly reachable: boolean;
  readonly hostId: string | null;
  readonly version: string | null;
}

export interface DiscoveredRemoteHost {
  readonly tailnetName: string;
  readonly hostId: string;
  readonly version: string;
}

/**
 * Normalize a Tailscale MagicDNS name: trim whitespace, strip trailing `.`, lowercase.
 */
export function normalizeTailnetName(raw: string): string {
  let trimmed = raw.trim();
  if (trimmed.endsWith(".")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.toLowerCase();
}

/**
 * Build a HostDirectoryEntry for a remote host discovered on a tailnet.
 * Constructs the WebSocket URL using the constant TAILNET_BRIDGE_HTTPS_PORT.
 */
export function toRemoteDirectoryEntry(input: {
  readonly tailnetName: string;
  readonly hostId: string;
  readonly label: string;
  readonly version: string | null;
  readonly status: HostAvailability;
}): HostDirectoryEntry {
  return {
    hostId: input.hostId,
    label: input.label,
    kind: "remote",
    websocketUrl: `wss://${input.tailnetName}:${TAILNET_BRIDGE_HTTPS_PORT}/rpc`,
    version: input.version,
    status: input.status,
  };
}
