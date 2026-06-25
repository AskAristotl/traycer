import { runCommand } from "../service/process-runner";
import type { RunResult } from "../service/process-runner";

export type ServeRunner = (args: readonly string[]) => Promise<RunResult>;

export function buildServeArgs(input: {
  readonly httpsPort: number;
  readonly bridgePort: number;
  readonly hostWsPort: number;
}): readonly string[][] {
  const https = `--https=${input.httpsPort}`;
  const bridge = `http://127.0.0.1:${input.bridgePort}`;
  const host = `http://127.0.0.1:${input.hostWsPort}`;
  return [
    ["serve", "--bg", https, "--set-path=/whoami", `${bridge}/whoami`],
    ["serve", "--bg", https, "--set-path=/healthz", `${bridge}/healthz`],
    ["serve", "--bg", https, "--set-path=/rpc", `${host}/rpc`],
    ["serve", "--bg", https, "--set-path=/stream", `${host}/stream`],
  ];
}

export async function applyServeConfig(input: {
  readonly httpsPort: number;
  readonly bridgePort: number;
  readonly hostWsPort: number;
  readonly run: ServeRunner;
}): Promise<void> {
  for (const args of buildServeArgs({
    httpsPort: input.httpsPort,
    bridgePort: input.bridgePort,
    hostWsPort: input.hostWsPort,
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
