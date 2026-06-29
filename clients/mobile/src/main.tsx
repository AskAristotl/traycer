import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  TraycerApp,
  hostRpcRegistry,
  createTailnetRemoteFetcher,
  useRemoteHostsStore,
} from "@traycer-clients/gui-app";
import { createWebRemoteHostsBridge } from "@traycer-clients/web";
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

function bootstrap(): void {
  const host = createMobileRunnerHost();

  const remoteBridge = createWebRemoteHostsBridge({
    fetchFn: (input) => fetch(input),
    bootstrapHosts: BOOTSTRAP_HOSTS,
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
