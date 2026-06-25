// Commands for managing the tailnet bridge as a per-user OS service.
// macOS (launchd) and Linux (systemd) only — win32 is guarded inside each
// command with a SERVICE_UNSUPPORTED_PLATFORM error.
export {
  buildBridgeServiceInstallCommand,
  bridgeServiceUninstallCommand,
  bridgeServiceStatusCommand,
} from "../tailnet/bridge-service";
