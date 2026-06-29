# Traycer Mobile Client — Implementation Plan

Execution checklist for `2026-06-29-traycer-mobile-client-design.md`. TDD, green per step, commit per sub-step on `feat/mobile-client`.

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

## Step 3 — Mobile screens (inside gui-app, `useIsMobile` branch at epic route)
- Inbox (notifications stream), Epic chat (virtuoso transcript + plain-text composer via `agent.sendMessage` + approval cards via `runtimeApprovalDecision` + permission-mode toggle), read-only Changes. No new-epic.

## Step 4 — Lifecycle
- `onSystemResumed` wired to reconnect + token-freshness check via CORS-safe path.

## Step 5 — Capacitor (`clients/mobile/`)
- Wrap same web build; `MobileRunnerHost` = native HTTP (drop proxy) + native keychain + `App` resume. Headless: scaffold + asset sync + builds. Human-gated: signing, device builds, store.

## Discipline
- After every sub-step: typecheck + lint + affected tests green. Commit. Never leave tree broken.
- Human-only stop points: iOS/Android signing, real-device builds, App Store.
