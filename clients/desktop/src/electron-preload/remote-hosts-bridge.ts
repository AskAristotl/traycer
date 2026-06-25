import { ipcRenderer } from "electron";
import { RunnerHostInvoke } from "../ipc-contracts/ipc-channels";
import type {
  DiscoveredRemoteHost,
  RemoteHostProbe,
} from "../ipc-contracts/remote-host-types";
import type { DesktopRemoteHostsBridge } from "../renderer-shell/desktop-runner-host";

export function buildRemoteHostsBridge(): DesktopRemoteHostsBridge {
  return {
    probe: (input) =>
      ipcRenderer.invoke(
        RunnerHostInvoke.remoteHostsProbe,
        input,
      ) as Promise<RemoteHostProbe>,
    enumerate: () =>
      ipcRenderer.invoke(
        RunnerHostInvoke.remoteHostsEnumerate,
      ) as Promise<readonly DiscoveredRemoteHost[]>,
  };
}
