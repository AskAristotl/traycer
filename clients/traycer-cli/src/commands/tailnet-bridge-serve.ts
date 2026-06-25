import { runTailnetBridge } from "../tailnet/bridge-runtime";
import { tailscaleServeRunner } from "../tailnet/serve-config";
import type { Environment } from "../runner/environment";

export interface TailnetBridgeServeArgs {
  readonly httpsPort: number;
  readonly environment: Environment | undefined;
  readonly pollIntervalMs: number;
}

export async function runTailnetBridgeServe(args: TailnetBridgeServeArgs): Promise<void> {
  const ac = new AbortController();
  const onSignal = (): void => ac.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  await runTailnetBridge({
    httpsPort: args.httpsPort,
    environment: args.environment,
    pollIntervalMs: args.pollIntervalMs,
    run: tailscaleServeRunner(),
    signal: ac.signal,
  });
}
