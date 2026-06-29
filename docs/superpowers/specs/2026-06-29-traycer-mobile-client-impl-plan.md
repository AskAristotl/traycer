# Traycer Mobile Client — Implementation Plan

Execution checklist for `2026-06-29-traycer-mobile-client-design.md`. TDD, green per step, commit per sub-step on `feat/mobile-client`.

## Status (2026-06-29)

| Step | State | Verification |
|---|---|---|
| 1a — bridge `/discover` + CORS | ✅ done | 6 shared + 18 traycer-cli tests, tsc, lint |
| 1b — mobile gateway (PWA serve + `/authn/*` proxy) | ✅ done | 17 tests, tsc, lint |
| 2 — `WebRunnerHost` + Vite/PWA entry | ✅ done | 19 tests, tsc, lint, **full `vite build` of gui-app** |
| 3 — responsive reuse (no custom screens) | ✅ (a) + canvas collapse done / 🟡 panel pixel-polish interactive | full gui-app mounts on mobile (build green); SplitContainer collapses to a single scrollable column on mobile (3 tests, 36 canvas tests green). Pixel-polish *inside* tiles (diff renderer, composer density) needs a live on-device session |
| 4 — lifecycle (`onSystemResumed` + token-on-resume) | ✅ done | `WebRunnerHost.onSystemResumed` (visibilitychange+online) wired into existing `stream-wake-reconnect`; token staleness via existing 401→refresh through the proxy. 8 tests |
| 5 — Capacitor target | ✅ scaffold done | `clients/mobile` (MobileRunnerHost reusing WebRunnerHost + native deps); tsc + lint + `vite build` green. `cap add ios/android` + scheme + signing human-gated |

**Runnable now:** `cd clients/web && npx vite build` → `traycer mobile-gateway serve --web-dir clients/web/dist` → `tailscale serve` → load PWA on phone → exercises `MobileHostGate` + bridge `/discover` host binding. Interactive sign-in additionally depends on `platform.traycer.ai` accepting the tailnet redirect URI (upstream allowlist; Capacitor's `traycer://` scheme sidesteps it).

## Step 1 — Bridge (`clients/traycer-cli/src/tailnet`)
- **1a. `/discover` + ACAO** ✅ target
  - `clients/shared/host-client/tailnet-discovery.ts`: pure `probeRemoteHostWith`, `enumerateTailnetHostsWith` (relocated from desktop `remote-probe.ts`, reuse `DiscoveredRemoteHost`/`RemoteHostProbe` from `tailnet-remote.ts`). + tests.
  - `clients/traycer-cli/src/tailnet/discover.ts`: IO composition — `tailscaleStatusJson` via `runCommand("tailscale",["status","--json"])`, `fetchWhoami` via `node:https`, `enumerateTailnetHosts()`.
  - `bridge-http-server.ts`: route `GET /discover` → `{ hosts }` (never throws → `{hosts:[]}`); add `Access-Control-Allow-Origin: *` to all JSON responses.
  - Desktop `remote-probe.ts` stays (electron-main CommonJS isolation).
- **1b. `/authn/*` proxy + static PWA serve** (spike-only, throwaway) — co-located so PWA + authn are same-origin. Likely a dedicated `mobile-gateway` runtime under traycer-cli using `node:http` (clean proxy/static) rather than the raw-TCP bridge. Decide at implementation.

## Step 2 — `WebRunnerHost` + web entry
- `clients/web/` (or gui-app entry): Vite `index.html` + `main.tsx` mounting `<TraycerApp runnerHost={new WebRunnerHost(...)}/>`.
- `WebRunnerHost implements IRunnerHost`: host-directory adapter (`probe` via HTTP `/whoami`, `enumerate` via `/discover`, reuse `remote-hosts-store`), auth via shared helpers w/ proxy base, `tokenStore`=IndexedDB, stubs for lifecycle/tray/file-drop/workspace/mic, real `onSystemResumed` via `visibilitychange`+`online`.

## Step 3 — Responsive reuse (NOT custom screens — Path B retracted)
Full gui-app reuse. Mobile UI work = responsive layout on the existing components:
- **3a. Single-pane canvas on mobile**: on `useIsMobile`, the canvas renders only the active tile (no splits, hide resize handles); the existing tab strip is the switcher. Component test asserts no resize handles on mobile.
- **3b. Responsive panels**: chat/diff/composer fit a ~390px viewport; verify against browser reload (and Playwright mobile-viewport screenshots of the pre-auth + reachable surfaces).
- Home = existing `/epics` list. No Inbox, no new screens, no new-epic UX added.

## Step 4 — Lifecycle
- `onSystemResumed` wired to reconnect + token-freshness check via CORS-safe path.

## Step 5 — Capacitor (`clients/mobile/`)
- Wrap same web build; `MobileRunnerHost` = native HTTP (drop proxy) + native keychain + `App` resume. Headless: scaffold + asset sync + builds. Human-gated: signing, device builds, store.

## Discipline
- After every sub-step: typecheck + lint + affected tests green. Commit. Never leave tree broken.
- Human-only stop points: iOS/Android signing, real-device builds, App Store.
