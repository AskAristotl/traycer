import * as https from "node:https";
import { execFile } from "node:child_process";
import type {
  RemoteHostProbe,
  DiscoveredRemoteHost,
} from "../../ipc-contracts/remote-host-types";
import { TAILNET_BRIDGE_HTTPS_PORT } from "../../ipc-contracts/remote-host-types";

const PROBE_TIMEOUT_MS = 750;
const MAX_WHOAMI_BODY_BYTES = 64 * 1024;

interface WhoamiResponse {
  readonly hostId: string;
  readonly version: string;
}

/**
 * Testable core: resolves a `RemoteHostProbe` by calling the injected
 * `getWhoami` dependency. On success returns `{ reachable: true, hostId,
 * version }`; on any throw returns the unreachable sentinel.
 */
export async function probeRemoteHostWith(
  input: { readonly tailnetName: string },
  deps: {
    readonly getWhoami: (
      tailnetName: string,
    ) => Promise<WhoamiResponse>;
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
 * Fetch `/whoami` from `https://<tailnetName>:<port>/whoami` with a 750ms
 * timeout via `node:https`. Returns the parsed `{ hostId, version }` or
 * throws on any error (connection failure, timeout, malformed JSON, missing
 * fields).
 */
function fetchWhoami(tailnetName: string): Promise<WhoamiResponse> {
  return new Promise((resolve, reject) => {
    const url = `https://${tailnetName}:${TAILNET_BRIDGE_HTTPS_PORT}/whoami`;

    let settled = false;

    const settle = (value: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      req.removeAllListeners();
      req.destroy();
      reject(value instanceof Error ? value : new Error(String(value)));
    };

    let body = "";
    let bodyBytes = 0;

    const req = https.get(
      url,
      {
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (settled) {
            return;
          }
          const nextBodyBytes = bodyBytes + Buffer.byteLength(chunk, "utf8");
          if (nextBodyBytes > MAX_WHOAMI_BODY_BYTES) {
            settle(
              new Error(
                `/whoami response exceeded ${MAX_WHOAMI_BODY_BYTES} bytes`,
              ),
            );
            return;
          }
          bodyBytes = nextBodyBytes;
          body += chunk;
        });
        res.on("end", () => {
          if (settled) {
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            settle(new Error("invalid JSON from /whoami"));
            return;
          }
          if (parsed === null || typeof parsed !== "object") {
            settle(new Error("/whoami did not return an object"));
            return;
          }
          const obj = parsed as Record<string, unknown>;
          const hostId = obj.hostId;
          const version = obj.version;
          if (typeof hostId !== "string" || typeof version !== "string") {
            settle(new Error("/whoami missing hostId or version string fields"));
            return;
          }
          const whoami: WhoamiResponse = { hostId, version };
          settled = true;
          resolve(whoami);
        });
        res.on("error", (err: Error) => settle(err));
      },
    );

    req.setTimeout(PROBE_TIMEOUT_MS, () => {
      settle(new Error(`/whoami timed out after ${PROBE_TIMEOUT_MS}ms`));
    });

    req.once("error", (err: Error) => settle(err));
  });
}

/**
 * Thin wrapper: supplies the real `node:https` GET to `probeRemoteHostWith`.
 */
export function probeRemoteHost(input: {
  readonly tailnetName: string;
}): Promise<RemoteHostProbe> {
  return probeRemoteHostWith(input, { getWhoami: fetchWhoami });
}

/**
 * Testable core: parse a `tailscale status --json` payload, probe each
 * online peer in parallel, return only those that are reachable with a
 * non-null `hostId`.
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

  const status = parsed as Record<string, unknown>;
  const peer = status.Peer;

  if (peer === null || typeof peer !== "object") {
    return [];
  }

  const peers = Object.values(peer as Record<string, unknown>);

  const onlineNames: string[] = peers.flatMap((p) => {
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
    // Strip trailing dot from Tailscale FQDN (e.g. "host.ts.net." → "host.ts.net")
    // and lowercase to match normalizeTailnetName
    const normalized = (dnsName.endsWith(".") ? dnsName.slice(0, -1) : dnsName).toLowerCase();
    return [normalized];
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

/**
 * Thin wrapper: supplies the real `tailscale status --json` subprocess and
 * the real `probeRemoteHost`.
 */
export function enumerateTailnetHosts(): Promise<
  readonly DiscoveredRemoteHost[]
> {
  return enumerateTailnetHostsWith({
    tailscaleStatusJson: () =>
      new Promise((resolve, reject) => {
        execFile("tailscale", ["status", "--json"], (error, stdout) => {
          if (error !== null) {
            reject(error);
            return;
          }
          resolve(stdout);
        });
      }),
    probe: (tailnetName) => probeRemoteHost({ tailnetName }),
  });
}
