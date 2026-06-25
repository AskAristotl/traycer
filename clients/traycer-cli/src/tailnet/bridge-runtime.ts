import type { Environment } from "../runner/environment";
import { startBridgeHttpServer } from "./bridge-http-server";
import { applyServeConfig, resetServeConfig, type ServeRunner } from "./serve-config";

export interface RunTailnetBridgeOptions {
  readonly httpsPort: number;
  readonly environment: Environment | undefined;
  readonly pollIntervalMs: number;
  readonly run: ServeRunner;
  readonly signal: AbortSignal;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

// Design B (see plans/2026-06-25-tailscale-remote-hosts.md): the bridge HTTP
// server is the single `tailscale serve` backend for every path. `/rpc` +
// `/stream` are re-originated to the host over loopback by the HTTP server
// itself (which rewrites `Host`/`Origin` so the host's WS guard accepts them and
// reads the host's ws port per-upgrade). The serve config therefore targets only
// the stable bridge port and is applied ONCE - it no longer tracks the host's ws
// port, so a host respawn needs no reconfiguration. `pollIntervalMs` is retained
// in the options for the command surface but is unused now that there is nothing
// to poll.
export async function runTailnetBridge(options: RunTailnetBridgeOptions): Promise<void> {
  const { httpsPort, environment, run, signal } = options;

  const httpServer = await startBridgeHttpServer({
    environment,
    host: "127.0.0.1",
    port: 0,
  });
  const bridgePort = httpServer.port;

  process.stderr.write(
    `[tailnet-bridge] HTTP bridge listening on 127.0.0.1:${bridgePort}\n`,
  );

  try {
    await applyServeConfig({ httpsPort, bridgePort, run });
    process.stderr.write(
      `[tailnet-bridge] serve config applied (https=${httpsPort} → bridge=${bridgePort})\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[tailnet-bridge] error applying serve config: ${String(err)}\n`,
    );
  }

  await waitForAbort(signal);

  process.stderr.write("[tailnet-bridge] signal aborted — resetting serve config\n");

  try {
    await resetServeConfig({ run });
  } catch (err) {
    process.stderr.write(
      `[tailnet-bridge] error resetting serve config: ${String(err)}\n`,
    );
  }

  try {
    await httpServer.close();
  } catch (err) {
    process.stderr.write(
      `[tailnet-bridge] error closing HTTP server: ${String(err)}\n`,
    );
  }

  process.stderr.write("[tailnet-bridge] shutdown complete\n");
}
