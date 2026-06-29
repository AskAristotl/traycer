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
import { parseDevAuthFragment } from "./web-dev-auth";
import "./index.css";

/**
 * Web/PWA entry. Mirrors `clients/desktop/src/renderer-shell/main.tsx` but
 * injects a `WebRunnerHost` (browser `IRunnerHost`) and a fetch-backed
 * tailnet remote-host fetcher. The same bundle is later wrapped by the
 * Capacitor shell, which swaps in `MobileRunnerHost`.
 */
async function bootstrap(): Promise<void> {
  const origin = window.location.origin;
  const config = loadWebConfig(
    import.meta.env as Record<string, string | undefined>,
    origin,
  );

  const tokenStore = createWebTokenStore(undefined);
  // PWA-spike sign-in escape hatch: interactive OAuth can't return to a tailnet
  // origin (upstream redirect-URI allowlist), so a desktop-obtained bearer can
  // be injected once via a `#devauth=` fragment. Write it to the token store
  // and scrub the fragment; `AuthService.start()` then rehydrates + validates.
  const devAuth = parseDevAuthFragment(window.location.hash);
  if (devAuth !== null) {
    await tokenStore.set(devAuth);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }

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
    tokenStore,
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

void bootstrap();
