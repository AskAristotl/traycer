/**
 * Plain-data mirror of `RemoteHostProbe` and `DiscoveredRemoteHost` from the
 * shared package. The Electron main process is CommonJS-isolated and cannot
 * import `@traycer-clients/shared` directly — we re-declare the shapes here so
 * they are available to the main-process probe + enumeration logic without
 * crossing the module-resolution boundary.
 *
 * Keep structurally identical to the shared versions by hand. If the shared
 * definitions change, update this file to match.
 */

/**
 * HTTPS port on which the Tailscale bridge serves its `/whoami` endpoint.
 * Kept equal to the shared `TAILNET_BRIDGE_HTTPS_PORT` constant by hand.
 */
export const TAILNET_BRIDGE_HTTPS_PORT = 8_443;

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
