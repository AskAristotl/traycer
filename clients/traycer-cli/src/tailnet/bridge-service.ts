import { existsSync } from "node:fs";
import { platform as osPlatform } from "node:os";
import type { Environment } from "../runner/environment";
import { CLI_ERROR_CODES, cliError } from "../runner/errors";
import type { CommandFn, CommandResult } from "../runner/runner";
import {
  createServiceController,
  resolveServiceCliInvocation,
  serviceManifestPath,
} from "../service";
import type { ServiceLabel } from "../service";
import { withCliLock } from "../store/cli-lock";

// Mirror the capitalization helper from service/label.ts.
function capitalizeEnvironment(environment: Environment): string {
  if (environment.length === 0) return environment;
  return environment.charAt(0).toUpperCase() + environment.slice(1);
}

const PRODUCTION_BRIDGE_LABEL: ServiceLabel = {
  id: "ai.traycer.tailnet-bridge",
  displayName: "Traycer Tailnet Bridge",
  environment: "production",
};

// Mirror serviceLabelFor but for the tailnet bridge service slot.
// production → ai.traycer.tailnet-bridge
// other      → ai.traycer.tailnet-bridge.<environment>
export function bridgeServiceLabelFor(environment: Environment): ServiceLabel {
  if (environment === "production") return PRODUCTION_BRIDGE_LABEL;
  return {
    id: `ai.traycer.tailnet-bridge.${environment}`,
    displayName: `Traycer Tailnet Bridge (${capitalizeEnvironment(environment)})`,
    environment,
  };
}

// Guard used by all three commands: the bridge service is macOS + Linux only.
// Windows Scheduled Tasks use a hardcoded name that would collide with the
// host's task (windowsTaskName ignores label.id), and serviceManifestPath
// returns "" on win32, breaking install-state detection.
function assertNotWin32(): void {
  if (osPlatform() === "win32") {
    throw cliError({
      code: CLI_ERROR_CODES.SERVICE_UNSUPPORTED_PLATFORM,
      message: "The tailnet bridge service is supported on macOS and Linux only.",
      details: null,
      exitCode: 1,
    });
  }
}

export interface BridgeServiceInstallArgs {
  readonly enableLinger: boolean;
  readonly allowSelfInvocation: boolean;
}

// Mirror buildServiceInstallCommand from commands/service-install.ts.
// The CLI invocation trailing args are ["tailnet-bridge", "serve"] so the
// bridge runs `traycer tailnet-bridge serve` under the OS supervisor.
export function buildBridgeServiceInstallCommand(
  args: BridgeServiceInstallArgs,
): CommandFn {
  return async (ctx): Promise<CommandResult> => {
    assertNotWin32();
    return withCliLock(
      {
        environment: ctx.runtime.environment,
        reason: "service-install",
        waitMs: 30_000,
        pollIntervalMs: 100,
      },
      async () => {
        const label = bridgeServiceLabelFor(ctx.runtime.environment);
        const resolved = await resolveServiceCliInvocation({
          environment: ctx.runtime.environment,
          override: null,
          allowSelfInvocation: args.allowSelfInvocation,
        });
        // Append "tailnet-bridge serve" to the resolved CLI args so the
        // OS service calls `<cli> [...resolved.args] tailnet-bridge serve`.
        const cli = {
          command: resolved.command,
          args: [...resolved.args, "tailnet-bridge", "serve"],
        };
        ctx.progress({
          stage: "register",
          message: `registering bridge service '${label.id}'`,
          percent: null,
          bytes: null,
          totalBytes: null,
        });
        await createServiceController().install({
          label,
          cli,
          enableLinger: args.enableLinger,
        });
        const manifestPath = serviceManifestPath(label);
        return {
          data: {
            label: label.id,
            displayName: label.displayName,
            environment: label.environment,
            manifestPath,
            cli: { command: cli.command, args: cli.args },
          },
          human: `bridge service '${label.id}' registered (environment=${label.environment})`,
          exitCode: 0,
        };
      },
    );
  };
}

// Mirror serviceUninstallCommand from commands/service-uninstall.ts.
export const bridgeServiceUninstallCommand: CommandFn = async (ctx): Promise<CommandResult> => {
  assertNotWin32();
  return withCliLock(
    {
      environment: ctx.runtime.environment,
      reason: "service-uninstall",
      waitMs: 30_000,
      pollIntervalMs: 100,
    },
    async () => {
      const label = bridgeServiceLabelFor(ctx.runtime.environment);
      ctx.progress({
        stage: "deregister",
        message: `deregistering bridge service '${label.id}'`,
        percent: null,
        bytes: null,
        totalBytes: null,
      });
      await createServiceController().uninstall({ label });
      return {
        data: { label: label.id, environment: label.environment },
        human: `bridge service '${label.id}' deregistered`,
        exitCode: 0,
      };
    },
  );
};

// Status command: reports installed state from manifest file existence only.
// Do NOT call controller.status() — it reads the host's pid.json, which is
// wrong for the bridge. Reachability must be verified from another machine.
export const bridgeServiceStatusCommand: CommandFn = async (ctx): Promise<CommandResult> => {
  assertNotWin32();
  const label = bridgeServiceLabelFor(ctx.runtime.environment);
  const manifestPath = serviceManifestPath(label);
  const installed = existsSync(manifestPath);
  const data = {
    label: label.id,
    environment: label.environment,
    displayName: label.displayName,
    manifestPath,
    installed,
  };
  const installedStr = installed ? "installed" : "not installed";
  const human =
    `Bridge service '${label.id}': ${installedStr}\n` +
    `  manifest: ${manifestPath}\n` +
    `  reachability: run 'traycer tailnet-bridge status' from another machine to verify`;
  return { data, human, exitCode: 0 };
};
