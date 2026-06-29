import { runMobileGateway } from "../mobile-gateway/gateway-runtime";
import { tailscaleServeRunner } from "../tailnet/serve-config";

export interface MobileGatewayServeArgs {
  readonly webDir: string;
  readonly httpsPort: number;
  readonly port: number;
  readonly authnOrigin: string;
}

/**
 * Foreground runner for the PWA-spike mobile gateway: serves the built web
 * assets and reverse-proxies `/authn/*` same-origin, fronted by
 * `tailscale serve` on `httpsPort`. SIGINT/SIGTERM tears the mount down.
 */
export async function runMobileGatewayServe(
  args: MobileGatewayServeArgs,
): Promise<void> {
  const ac = new AbortController();
  const onSignal = (): void => ac.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  await runMobileGateway({
    webDir: args.webDir,
    httpsPort: args.httpsPort,
    port: args.port,
    authnOrigin: args.authnOrigin,
    run: tailscaleServeRunner(),
    signal: ac.signal,
  });
}
