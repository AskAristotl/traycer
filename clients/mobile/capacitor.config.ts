import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the same gui-app web build. The two things that make the
 * mobile shell work without any infra the PWA spike needs:
 *
 *  - `CapacitorHttp.enabled` patches the WebView's `fetch` to a NATIVE HTTP
 *    client. The shared auth helpers then reach `authn.traycer.ai` directly
 *    with no CORS (native HTTP is not browser-origin-gated) and no `/authn`
 *    proxy — the mobile analog of the desktop running auth in Electron's Node.
 *  - the host RPC WebSocket dials each bridge's `wss://<host>:8443/rpc`
 *    directly over the tailnet (Tailscale VPN on the device), no gateway.
 */
const config: CapacitorConfig = {
  appId: "ai.askaristotl.traycer",
  appName: "Traycer",
  webDir: "dist",
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
