import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  TraycerApp,
  hostRpcRegistry,
  createTailnetRemoteFetcher,
  useRemoteHostsStore,
} from "@traycer-clients/gui-app";
import { createWebRemoteHostsBridge } from "@traycer-clients/web";
import { TAILNET_BRIDGE_HTTPS_PORT } from "@traycer-clients/shared/host-client/tailnet-remote";
import { createMobileRunnerHost } from "./mobile-runner-host";
import "./index.css";

/**
 * Capacitor entry. Same gui-app, same web bundle pattern as `clients/web`, but
 * injects the native `MobileRunnerHost` (native HTTP, Preferences storage,
 * deep-link auth) and reaches each host's `/whoami` + `/discover` over native
 * HTTP (CapacitorHttp patches `fetch`), so no gateway/proxy is involved.
 */
const BOOTSTRAP_HOSTS = (
  (import.meta.env as Record<string, string | undefined>)
    .VITE_BOOTSTRAP_HOSTS ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// No gateway on native: discover via the first bootstrap bridge's
// `:8443/discover` directly (native HTTP bypasses CORS). Empty when no
// bootstrap host is configured — discovery then yields nothing and the user
// adds hosts manually.
const DISCOVER_URL =
  BOOTSTRAP_HOSTS.length > 0
    ? `https://${BOOTSTRAP_HOSTS[0]}:${TAILNET_BRIDGE_HTTPS_PORT}/discover`
    : "";

function bootstrap(): void {
  const host = createMobileRunnerHost();

  const remoteBridge = createWebRemoteHostsBridge({
    fetchFn: (input) => fetch(input),
    discoverUrl: DISCOVER_URL,
  });
  (globalThis as { runnerHost?: unknown }).runnerHost = {
    remoteHosts: remoteBridge,
  };

  const remoteFetcher = createTailnetRemoteFetcher({
    probe: (input) => remoteBridge.probe(input),
    enumerate: () => remoteBridge.enumerate(),
    readState: () => {
      const s = useRemoteHostsStore.getState();
      return {
        manualHosts: s.manualHosts,
        disabledDiscovered: s.disabledDiscovered,
      };
    },
  });

  const container = document.getElementById("root");
  if (container === null) {
    throw new Error("#root element not found in index.html");
  }

  createRoot(container).render(
    <StrictMode>
      <TraycerApp
        runnerHost={host}
        registry={hostRpcRegistry}
        remoteFetcher={remoteFetcher}
        initialRoute={null}
      />
    </StrictMode>,
  );
}

bootstrap();
