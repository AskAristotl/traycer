import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  TraycerApp,
  hostRpcRegistry,
  createTailnetRemoteFetcher,
  useRemoteHostsStore,
} from "@traycer-clients/gui-app";
import { WebRunnerHost, createBrowserEnv } from "./web-runner-host";
import { createWebSecureStorage, createWebTokenStore } from "./web-storage";
import { createWebRemoteHostsBridge } from "./web-remote-hosts";
import { loadWebConfig, composeWebSignInUrl } from "./web-config";
import "./index.css";

/**
 * Web/PWA entry. Mirrors `clients/desktop/src/renderer-shell/main.tsx` but
 * injects a `WebRunnerHost` (browser `IRunnerHost`) and a fetch-backed
 * tailnet remote-host fetcher. The same bundle is later wrapped by the
 * Capacitor shell, which swaps in `MobileRunnerHost`.
 */
function bootstrap(): void {
  const origin = window.location.origin;
  const config = loadWebConfig(
    import.meta.env as Record<string, string | undefined>,
    origin,
  );

  const notificationApi =
    typeof Notification !== "undefined"
      ? {
          get permission(): NotificationPermission {
            return Notification.permission;
          },
          show: (title: string, body: string): void => {
            new Notification(title, { body });
          },
        }
      : null;

  const host = new WebRunnerHost({
    signInUrl: composeWebSignInUrl(config.signInBaseUrl, config.authRedirectUri),
    authnBaseUrl: config.authnBaseUrl,
    signInBaseUrl: config.signInBaseUrl,
    secureStorage: createWebSecureStorage(undefined),
    tokenStore: createWebTokenStore(undefined),
    env: createBrowserEnv(),
    notificationApi,
  });

  const remoteBridge = createWebRemoteHostsBridge({
    fetchFn: (input) => fetch(input),
    bootstrapHosts: config.bootstrapHosts,
  });

  // The remote-hosts settings panel feature-detects `window.runnerHost
  // .remoteHosts.probe`. The desktop preload installs it; mirror that here so
  // manual host-add works on web.
  (globalThis as { runnerHost?: unknown }).runnerHost = {
    remoteHosts: remoteBridge,
  };

  // Built once before render — referentially stable across re-renders.
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
