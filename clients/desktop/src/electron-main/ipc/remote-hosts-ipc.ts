import { RunnerHostInvoke } from "../../ipc-contracts/ipc-channels";
import type {
  RemoteHostProbe,
  DiscoveredRemoteHost,
} from "../../ipc-contracts/remote-host-types";

export interface RemoteHostsDeps {
  readonly probe: (input: {
    readonly tailnetName: string;
  }) => Promise<RemoteHostProbe>;
  readonly enumerate: () => Promise<readonly DiscoveredRemoteHost[]>;
}

export interface RemoteHostsIpcBridge {
  handleInvoke(
    channel: string,
    handler: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
}

function readTailnetName(raw: unknown): string {
  if (raw === null || typeof raw !== "object") {
    throw new Error("remoteHosts.probe requires { tailnetName }");
  }
  const name = (raw as Record<string, unknown>).tailnetName;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("remoteHosts.probe requires a non-empty tailnetName");
  }
  return name;
}

export function registerRemoteHostsIpc(
  bridge: RemoteHostsIpcBridge,
  deps: RemoteHostsDeps,
): void {
  bridge.handleInvoke(
    RunnerHostInvoke.remoteHostsProbe,
    async (_event, raw: unknown) => {
      return deps.probe({ tailnetName: readTailnetName(raw) });
    },
  );
  bridge.handleInvoke(RunnerHostInvoke.remoteHostsEnumerate, async () => {
    return deps.enumerate();
  });
}
