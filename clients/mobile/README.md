# @traycer-clients/mobile — Capacitor shell

Wraps the **same gui-app** as the web/PWA shell, but injects a native
`MobileRunnerHost` (`src/mobile-runner-host.ts`) that reuses `WebRunnerHost`
with native deps:

- **Native HTTP** (`CapacitorHttp.enabled` in `capacitor.config.ts`) patches the
  WebView `fetch`, so the shared auth helpers reach `authn.traycer.ai` directly
  with **no CORS and no `/authn` proxy** — the mobile analog of the desktop's
  Electron-main auth.
- **Deep-link OAuth** via the desktop's already-registered `traycer://` scheme
  (`App.appUrlOpen` → `host.emitAuthCallback`), so `platform.traycer.ai` accepts
  the redirect with no new allowlist entry — the PWA spike's redirect-URI caveat
  does not apply here.
- **Storage** via `@capacitor/preferences` (see the keychain note below).
- **Resume** via the Capacitor `App` `resume` event, feeding the same
  `onSystemResumed` → reconnect path.

Host RPC dials each bridge's `wss://<host>:8443/rpc` directly over the device's
Tailscale VPN. No gateway.

## Headless (done / scriptable)

```sh
cd clients/mobile
bun run build:web            # vite build → dist/ (the Capacitor webDir)
```

## Human-gated (needs your hardware/credentials)

These need Xcode / Android Studio / signing identities and cannot run headless:

1. **Add native platforms:** `npx cap add ios` and/or `npx cap add android`.
2. **Register the `traycer://` URL scheme** in the native projects
   (iOS `Info.plist` `CFBundleURLSchemes`; Android intent-filter) so the OAuth
   deep link returns to the app.
3. **Sync + open:** `npx cap sync`, then `npx cap open ios` / `open android`.
4. **Signing + device build + App Store / Play submission.**

## Hardening TODO

`@capacitor/preferences` is app-private storage (UserDefaults /
SharedPreferences), **not** the OS Keychain/Keystore. For the secure token store
the design calls for, swap the two storage factories in `mobile-runner-host.ts`
onto a secure-storage plugin (e.g. `@capacitor-community/secure-storage-plugin`).
The `IRunnerHost` contract is unchanged.
