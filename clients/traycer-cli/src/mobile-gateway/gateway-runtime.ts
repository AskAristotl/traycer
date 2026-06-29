import { startMobileGateway } from "./gateway-server";
import type { ServeRunner } from "../tailnet/serve-config";

/**
 * `tailscale serve` args that mount the loopback gateway at the tailnet root on
 * `httpsPort`. Additive (`--bg`) and scoped to its own port, so it never
 * disturbs the host bridge's `--https=8443` mounts on the same node.
 */
export function buildGatewayServeArgs(input: {
  readonly httpsPort: number;
  readonly gatewayPort: number;
}): readonly string[] {
  return [
    "serve",
    "--bg",
    `--https=${input.httpsPort}`,
    `http://127.0.0.1:${input.gatewayPort}`,
  ];
}

/**
 * Best-effort teardown of just this gateway's mount. Scoped to its port with
 * `off` rather than a global `serve reset`, which would also wipe the host
 * bridge's mounts when both run on the same machine.
 */
export function buildGatewayServeOffArgs(input: {
  readonly httpsPort: number;
}): readonly string[] {
  return ["serve", `--https=${input.httpsPort}`, "off"];
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

export interface RunMobileGatewayOptions {
  readonly webDir: string;
  readonly httpsPort: number;
  readonly port: number;
  readonly authnOrigin: string;
  readonly run: ServeRunner;
  readonly signal: AbortSignal;
}

export async function runMobileGateway(
  options: RunMobileGatewayOptions,
): Promise<void> {
  const gateway = await startMobileGateway({
    webDir: options.webDir,
    port: options.port,
    authnOrigin: options.authnOrigin,
  });
  process.stderr.write(
    `[mobile-gateway] serving ${options.webDir} on 127.0.0.1:${gateway.port}\n`,
  );

  try {
    await options.run(
      buildGatewayServeArgs({
        httpsPort: options.httpsPort,
        gatewayPort: gateway.port,
      }),
    );
    process.stderr.write(
      `[mobile-gateway] tailscale serve applied (https=${options.httpsPort} → gateway=${gateway.port})\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[mobile-gateway] error applying serve config: ${String(err)}\n`,
    );
  }

  await waitForAbort(options.signal);
  process.stderr.write("[mobile-gateway] signal aborted — tearing down\n");

  try {
    await options.run(
      buildGatewayServeOffArgs({ httpsPort: options.httpsPort }),
    );
  } catch (err) {
    process.stderr.write(
      `[mobile-gateway] error removing serve config: ${String(err)}\n`,
    );
  }
  await gateway.close();
  process.stderr.write("[mobile-gateway] shutdown complete\n");
}
