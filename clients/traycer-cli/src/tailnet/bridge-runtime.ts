import type { Environment } from "../runner/environment";
import { startBridgeHttpServer } from "./bridge-http-server";
import { readBridgeHostEndpoint, type BridgeHostEndpoint } from "./host-endpoint";
import { applyServeConfig, resetServeConfig, type ServeRunner } from "./serve-config";

export interface RunTailnetBridgeOptions {
  readonly httpsPort: number;
  readonly environment: Environment | undefined;
  readonly pollIntervalMs: number;
  readonly run: ServeRunner;
  readonly signal: AbortSignal;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal.aborted) {
      clearTimeout(timer);
      resolve();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runTailnetBridge(options: RunTailnetBridgeOptions): Promise<void> {
  const { httpsPort, environment, pollIntervalMs, run, signal } = options;

  const httpServer = await startBridgeHttpServer({
    environment,
    host: "127.0.0.1",
    port: 0,
  });
  const bridgePort = httpServer.port;

  process.stderr.write(
    `[tailnet-bridge] HTTP bridge listening on 127.0.0.1:${bridgePort}\n`,
  );

  let lastAppliedWsPort: number | null = null;

  while (!signal.aborted) {
    let endpoint: BridgeHostEndpoint | null;
    try {
      endpoint = await readBridgeHostEndpoint(environment);
    } catch (err) {
      process.stderr.write(
        `[tailnet-bridge] error reading host endpoint: ${String(err)}\n`,
      );
      await sleep(pollIntervalMs, signal);
      continue;
    }

    if (endpoint === null) {
      process.stderr.write("[tailnet-bridge] host endpoint not available yet — waiting\n");
    } else if (endpoint.wsPort !== lastAppliedWsPort) {
      process.stderr.write(
        `[tailnet-bridge] applying serve config for wsPort=${endpoint.wsPort}\n`,
      );
      try {
        await applyServeConfig({
          httpsPort,
          bridgePort,
          hostWsPort: endpoint.wsPort,
          run,
        });
        lastAppliedWsPort = endpoint.wsPort;
      } catch (err) {
        process.stderr.write(
          `[tailnet-bridge] error applying serve config: ${String(err)}\n`,
        );
      }
    }

    await sleep(pollIntervalMs, signal);
  }

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
