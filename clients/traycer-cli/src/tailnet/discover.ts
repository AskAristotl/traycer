import * as https from "node:https";
import {
  enumerateTailnetHostsWith,
  probeRemoteHostWith,
} from "@traycer-clients/shared/host-client/tailnet-discovery";
import type {
  DiscoveredRemoteHost,
  RemoteHostProbe,
  TailnetWhoami,
} from "@traycer-clients/shared/host-client/tailnet-remote";
import { TAILNET_BRIDGE_HTTPS_PORT } from "@traycer-clients/shared/host-client/tailnet-remote";
import { runCommand } from "../service/process-runner";

const PROBE_TIMEOUT_MS = 750;
const MAX_WHOAMI_BODY_BYTES = 64 * 1024;

/**
 * Fetch `https://<tailnetName>:<port>/whoami` with a short timeout via
 * `node:https`. Resolves the parsed `{ hostId, version }` or throws on any
 * error (connection failure, timeout, oversized/malformed body, missing
 * fields). The peer's bridge fronts `/whoami` with a publicly-trusted
 * `tailscale serve` cert, so default TLS verification applies.
 */
function fetchWhoami(tailnetName: string): Promise<TailnetWhoami> {
  return new Promise((resolve, reject) => {
    const url = `https://${tailnetName}:${TAILNET_BRIDGE_HTTPS_PORT}/whoami`;
    let settled = false;
    let body = "";
    let bodyBytes = 0;

    const settle = (value: unknown): void => {
      if (settled) return;
      settled = true;
      req.removeAllListeners();
      req.destroy();
      reject(value instanceof Error ? value : new Error(String(value)));
    };

    const req = https.get(url, { timeout: PROBE_TIMEOUT_MS }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        if (settled) return;
        bodyBytes += Buffer.byteLength(chunk, "utf8");
        if (bodyBytes > MAX_WHOAMI_BODY_BYTES) {
          settle(new Error("/whoami response too large"));
          return;
        }
        body += chunk;
      });
      res.on("end", () => {
        if (settled) return;
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
        if (typeof obj.hostId !== "string" || typeof obj.version !== "string") {
          settle(new Error("/whoami missing hostId or version"));
          return;
        }
        settled = true;
        resolve({ hostId: obj.hostId, version: obj.version });
      });
      res.on("error", (err: Error) => settle(err));
    });

    req.setTimeout(PROBE_TIMEOUT_MS, () =>
      settle(new Error(`/whoami timed out after ${PROBE_TIMEOUT_MS}ms`)),
    );
    req.once("error", (err: Error) => settle(err));
  });
}

function probeRemoteHost(input: {
  readonly tailnetName: string;
}): Promise<RemoteHostProbe> {
  return probeRemoteHostWith(input, { getWhoami: fetchWhoami });
}

function tailscaleStatusJson(): Promise<string> {
  return runCommand("tailscale", ["status", "--json"], {
    env: undefined,
    cwd: undefined,
    timeoutMs: 5_000,
    tolerateNonZeroExit: true,
  }).then((result) => result.stdout);
}

/**
 * Enumerate the Traycer hosts reachable on this machine's tailnet:
 * `tailscale status --json` (this node sees every peer) + a `/whoami` probe of
 * each online peer. Served by the bridge's `GET /discover` so a mobile client —
 * which has no `tailscale` CLI of its own — bootstraps the whole tailnet from a
 * single reachable bridge. Never throws.
 */
export function enumerateTailnetHosts(): Promise<
  readonly DiscoveredRemoteHost[]
> {
  return enumerateTailnetHostsWith({
    tailscaleStatusJson,
    probe: (tailnetName) => probeRemoteHost({ tailnetName }),
  });
}
