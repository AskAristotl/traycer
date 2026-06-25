import type { Environment } from "../runner/environment";
import { readHostPidMetadata } from "../host/pid-metadata";

export interface BridgeHostEndpoint {
  readonly hostId: string;
  readonly version: string;
  readonly wsPort: number;
}

export function parseHostWsPort(websocketUrl: string): number | null {
  if (!URL.canParse(websocketUrl)) {
    return null;
  }
  const parsed = new URL(websocketUrl);
  if (parsed.port.length === 0) {
    return null;
  }
  const port = Number.parseInt(parsed.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }
  return port;
}

export async function readBridgeHostEndpoint(
  environment: Environment | undefined,
): Promise<BridgeHostEndpoint | null> {
  const meta = await readHostPidMetadata(environment);
  if (meta === null) {
    return null;
  }
  const wsPort = parseHostWsPort(meta.websocketUrl);
  if (wsPort === null) {
    return null;
  }
  return { hostId: meta.hostId, version: meta.version, wsPort };
}
