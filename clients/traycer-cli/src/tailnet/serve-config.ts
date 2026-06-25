import { runCommand } from "../service/process-runner";
import type { RunResult } from "../service/process-runner";

export type ServeRunner = (args: readonly string[]) => Promise<RunResult>;

// Design B (see plans/2026-06-25-tailscale-remote-hosts.md, Task 0.1): the bridge
// HTTP server is the SINGLE `tailscale serve` backend for every path, including
// `/rpc` + `/stream`. `tailscale serve` forwards the inbound `Host` header
// (`<tailnetName>:8443`) unchanged, and the host's WS server rejects any
// non-loopback `Host`/`Origin` with 403 (DNS-rebinding / CSWSH guard) - so
// routing `/rpc` straight at the host port (the old Design A) made every remote
// WebSocket handshake fail with `RetryableTransportError`. Pointing `/rpc` +
// `/stream` at the bridge lets the bridge re-originate the upgrade to the host
// over loopback (rewriting `Host`/`Origin`), which the host accepts. The bridge
// port is stable for the bridge's lifetime, so this config no longer depends on
// the host's ws port and never needs re-applying on host respawn.
export function buildServeArgs(input: {
  readonly httpsPort: number;
  readonly bridgePort: number;
}): readonly string[][] {
  const https = `--https=${input.httpsPort}`;
  const bridge = `http://127.0.0.1:${input.bridgePort}`;
  return [
    ["serve", "--bg", https, "--set-path=/whoami", `${bridge}/whoami`],
    ["serve", "--bg", https, "--set-path=/healthz", `${bridge}/healthz`],
    ["serve", "--bg", https, "--set-path=/rpc", `${bridge}/rpc`],
    ["serve", "--bg", https, "--set-path=/stream", `${bridge}/stream`],
  ];
}

export async function applyServeConfig(input: {
  readonly httpsPort: number;
  readonly bridgePort: number;
  readonly run: ServeRunner;
}): Promise<void> {
  for (const args of buildServeArgs({
    httpsPort: input.httpsPort,
    bridgePort: input.bridgePort,
  })) {
    await input.run(args);
  }
}

export async function resetServeConfig(input: { readonly run: ServeRunner }): Promise<void> {
  await input.run(["serve", "reset"]);
}

export function tailscaleServeRunner(): ServeRunner {
  return async (args: readonly string[]): Promise<RunResult> => {
    return runCommand("tailscale", [...args], {
      env: undefined,
      cwd: undefined,
      timeoutMs: 15_000,
      tolerateNonZeroExit: true,
    });
  };
}
