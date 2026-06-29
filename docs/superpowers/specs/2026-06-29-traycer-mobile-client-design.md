# Traycer Mobile Client — Design & Decisions (grilled)

**Status:** Decisions captured & verified against the repo + live tailnet
**Date:** 2026-06-29 (supersedes the 2026-06-28 draft)
**Owner:** Dylan Verbreyt
**Context:** Private fork (`AskAristotl/traycer`, upstream `traycerai/traycer`) with the Tailscale remote-host bridge already built and **running** on the desktops.

> This revises the 2026-06-28 draft after a full grilling pass. Every load-bearing
> claim below was checked against the code or tested live on the tailnet. The
> headline changes from the draft: **Tauri → Capacitor**, **"reflow the workspace"
> → "purpose-built mobile surface (Path B)"**, **"auth CORS must be sane" → "auth
> CORS is a hard, unfixable block; solve with native HTTP"**, and **"auto-discovery
> is lost on mobile" → "auto-discovery via a new bridge `/discover` endpoint"**.

---

## 1. Goal

Drive Traycer from a phone — keep running agents **unblocked** (approve/reject, steer, chat) and glance at what changed — against hosts already running on the desktops. The phone is another client; no protocol change.

The phone's job is **not** "do the work" (that's the desktop). It's "**keep the work moving while you're away from the desk.**" That framing drives every decision below.

---

## 2. Premise check — what's actually done (verified live)

The draft claimed "host reachability — the genuinely hard infra piece — is done." **Verified true for a phone, at the transport layer**, with a narrower remaining gap than the draft implied.

- The Tailscale bridge is **already implemented and running**: `clients/traycer-cli/src/tailnet/` (`bridge-http-server.ts`, `serve-config.ts`, `bridge-runtime.ts`), specced in `docs/superpowers/specs/2026-06-25-tailscale-remote-hosts-design.md`. It runs as a launchd/systemd service per desktop, serves `/healthz` + `/whoami`, reverse-proxies `/rpc` + `/stream` to the host's loopback WS port, and is fronted by `tailscale serve --https=8443` with a real MagicDNS cert.
- **Tested live, confirmed working from mobile:**
  - `https://platos-mac-studio.mercat-elver.ts.net:8443/healthz` → `{"ok":true}`
  - `…:8443/whoami` → `{"hostId":"9105a3d5-…","version":"1.0.0"}`
  - Port is **8443** (the deployed value), not 443 (443 is closed; the old spec's "port 443" plan is not what shipped).
- **The RPC transport works from a mobile browser**: WebSockets aren't CORS-bound, and `bridge-http-server.ts` rewrites `Host`/`Origin` to loopback before forwarding, defeating the host's CSWSH guard. So `wss://<host>.<tailnet>.ts.net:8443/rpc` connects from mobile Safari.

**The real remaining gap is client-side, not infra:**
1. Auto-discovery (`tailscale status --json`) and the `/whoami` probe are Electron-/Node-only today (electron-main + a preload-injected `window.runnerHost.remoteHosts.probe`). Neither ports to a phone as-is. → solved by **bridge `/discover`** (§7) + **native HTTP** (§5).
2. `/whoami` sends no `Access-Control-Allow-Origin`. → 2-line ACAO for the PWA spike; native HTTP makes it moot under Capacitor.

---

## 3. Architecture the mobile client reuses

Mobile = a **third `IRunnerHost` implementation** (`clients/shared/platform/runner-host.ts`) alongside `DesktopRunnerHost`. Not a protocol change, not a rewrite. The repo's own `IRunnerHost` docblock already names the mobile shell as **Capacitor** (`Capacitor.Plugins.RunnerHost.get()`) — see §5.

Reused unchanged:
- **Protocol + transport**: versioned WS RPC, `WsRpcClient`, `host-client`, `auth-aware-messenger`, and the full reconnect stack (heartbeat, jittered backoff, auto-resubscribe, snapshot-delta resync). See §8.
- **Host directory**: `createTailnetRemoteFetcher` (`clients/gui-app/src/lib/host/tailnet-remote-fetcher.ts`) with injectable `probe`/`enumerate`/`readState`; the persisted `remote-hosts-store` (zustand/persist); `toRemoteDirectoryEntry` (`wss://<name>:8443/rpc`). All shell-agnostic.
- **`MobileHostGate`** (`clients/gui-app/src/components/layout/shell/mobile-host-gate.tsx`) + `useIsMobile` (768px). `hasLocalHost = false` on mobile.
- **Cross-epic notifications stream** (`useNotificationsList` / `useNotificationsUnread`, `NotificationEntry`, `notification-formatter`) — the data source for the Inbox home screen.
- The epic stores, query hooks, and `react-virtuoso` message list.

**Not reused** (the deliberate Path-B cut): the `TileCanvas` workspace — a recursive `ResizablePanelGroup` split tree with dnd-kit tab tiles (`clients/gui-app/src/components/epic-canvas/`) and the heavy DOM surfaces inside it (xterm, CodeMirror, Tiptap, `@pierre/diffs`). It does not reflow to a phone; mobile renders its own surface (§6).

---

## 4. Decisions (with rationale)

### D1 — Path B: purpose-built mobile surface, not workspace reflow. **Terminal out of v1.**
The workspace is a recursive resizable split-tree, not a multi-column layout that "collapses." There is no single column it degrades to — it's *replace*, not *reflow*. So mobile mounts the **full gui-app** and **branches at the epic route** (reusing auth, host directory, providers, stores, protocol) but renders mobile screens **instead of `TileCanvas`**. The terminal (xterm) and code editing are **out of v1** — they're the worst mobile UX and the heaviest DOM, and Path B doesn't mount them, so the draft's "DOM-bound blockers" anxiety largely evaporates.

### D2 — Shell: **Capacitor end-state, reached via a throwaway PWA spike. Tauri dropped.**
- **Tauri dropped.** Nothing in the analysis favors Tauri *over* Capacitor; the draft's Tauri rationale ("keeps 100% of gui-app," "native keychain") is equally true of Capacitor. Capacitor is what the repo's `IRunnerHost` docblock already names, has mature mobile/native-HTTP/keychain/push plugins, and the draft's own §8 admits Tauri-mobile is the least-trodden surface.
- **Capacitor wins on the auth finding (D3):** native HTTP escapes the authn CORS wall with **zero infra** — the mobile analog of the desktop's electron-main. A pure PWA can't.
- **PWA + tiny bridge authn-proxy as a 1-week spike** first, to validate the *uncertain* things (is the `WebRunnerHost` sound? are the screens useful? is phone-driving worth it?) **before** investing in a native build pipeline. The proxy + PWA-serving is the only throwaway; the web build, `WebRunnerHost`, host-directory adapter, and screens all carry into Capacitor unchanged.

### D3 — Auth: **native HTTP (Capacitor) direct to authn; same-origin proxy for the PWA spike. PKCE redirect, not device-flow.**
`authn.traycer.ai` returns `access-control-allow-origin: https://platform.traycer.ai` for **every** origin (tested with a tailnet origin and `evil.example.com`). It's a hardcoded pin, **not** a reflecting allowlist, and it's **upstream's service — we can't change it.** Consequences:
- A *browser* PWA at a tailnet origin is **hard-blocked** from `exchangeCodeForTokens` / `validateAuthTokenViaHttp` / `refreshAuthTokenViaHttp` (`clients/shared/auth/auth-validation.ts`). Even the desktop never auths from its browser layer — it runs auth in **electron-main (Node)** precisely to escape this.
- **Device-flow does NOT help** — its token-poll endpoint is on the same pinned host. (The draft's "device-flow is ideal" is a red herring for *this* problem.)
- **Capacitor**: auth runs in **native HTTP outside the WebView** → no CORS → direct to `authn.traycer.ai`, no proxy, no infra. Also dissolves the `/whoami` probe CORS for free.
- **PWA spike**: a browser can't escape CORS, so route the authn *fetches* through a same-origin server-side proxy (a ~30-line `/authn/*` path on the bridge you own, served same-origin with the PWA). The proxy is a transparent pass-through to the *real* authn — not a reimplementation, not a Traycer-side change. `signInUrl` still points at `platform.traycer.ai` (top-level navigation isn't CORS-bound); only the token fetches need the proxy. The redirect URI is already per-shell configurable (`authRedirectUri` sync channel) → register `https://<gateway>/auth/callback`.

### D4 — Authorization: **sign in as the host-owner account → full control. Reused.**
The host validates the bearer JWT per-connection and runs team-backed role checks (remote-hosts spec lines 89–112); every bearer/host is one `userId` → **owner role, full `canAct`**. The phone signs in as the same Traycer account that owns the desktop → full control, with the bearer threaded into the WS by the **reused** `WsRpcClient`/`auth-aware-messenger`. **No new authorization code.**
- Caveat A: a *provider* (Claude/Codex) re-auth routes to the host's CLI (`provider-reauth-banner.tsx`) — the phone can't fix it; you'd touch the host.
- Caveat B: multi-person = **shared single account** (you + Lewie share one Traycer login).

### D5 — Discovery: **bridge `/discover` endpoint; bootstrap from one configured host.**
Relocate the existing, test-covered `enumerateTailnetHosts` (`clients/desktop/src/electron-main/host/remote-probe.ts`: `tailscale status --json` + per-peer `/whoami`) into the bridge runtime (it runs on a desktop that *has* the `tailscale` CLI and already shells out) and expose it at `GET /discover`. The phone bootstraps from **one** configured bridge (default: Plato) and auto-discovers the whole tailnet (any node sees all peers). The `WebRunnerHost` injects `enumerate: () => fetch('https://<bootstrap>:8443/discover')`; `MobileHostGate`'s zero/one/many flow then works as the draft envisioned. No new credential; tailnet-gated like `/whoami`. (Rejected alternatives: Tailscale Admin API — needs an admin secret on-device, Capacitor-only; LocalAPI — inaccessible to third-party mobile apps; mDNS — doesn't traverse the mesh.)

### D6 — Screens: **Inbox-first, 3 screens.**
1. **Inbox (home)** — attention-first feed over the existing cross-epic notifications stream: approval requests, `awaiting-input`, errored, turn-complete; tap → jump to the epic. This is the deliberate divergence from the desktop's workspace-first model and the whole point of the phone client.
2. **Epic chat** — reused `react-virtuoso` transcript + a **simplified plain-text composer** (steer via `agent.sendMessage`; Tiptap rich/@mentions deferred) + **inline approval cards** (big approve/reject/dismiss targets, `runtimeApprovalDecision`) + a **permission-mode toggle** (flip an agent to auto-approve from the phone so you're not tapping 20× — a force-multiplier for the inbox model).
3. **Changes** — minimal **read-only** diff, file-by-file (first thing to cut if time-boxed).
- **No new-epic creation** on mobile in v1 (you start work at the desk).

### D7 — Connection lifecycle: **implement `onSystemResumed` on mobile (don't no-op it).**
Reconnect correctness is already solved and reused (heartbeat, jittered backoff, auto-resubscribe, snapshot-delta resync). The only gap is the *resume trigger*: `IRunnerHost.onSystemResumed` no-ops on web/mobile, and `window` `online` doesn't fire on app-foreground/unlock — so a re-opened app stares at a stale inbox until the heartbeat times out. Implement `onSystemResumed`:
- **PWA spike**: `document` `visibilitychange` (→ visible) + `window` `online`.
- **Capacitor**: `App` `resume` / `appStateChange`.
Also kick a **token-freshness check on resume** (the ~4h refresh timer is suspended while asleep, so the bearer may be dead) through the CORS-safe auth path (D3). Net: open app → foreground event → refresh-if-stale → force reconnect → live inbox in <1s.

### D8 — Token store: IndexedDB/localStorage (PWA spike) → **native keychain** (Capacitor `MobileRunnerHost`).

---

## 5. Revised work plan (sequenced)

Everything except the proxy + PWA-serving carries forward into Capacitor unchanged.

1. **`WebRunnerHost`** (`IRunnerHost` for a browser shell) — host-directory adapter (`probe` via HTTP `/whoami`, `enumerate` via `/discover`, reuse `readState`/store); auth via shared helpers pointed at the proxy base; `tokenStore` = IndexedDB; stubs/no-ops for host lifecycle/tray/file-drop/workspace-pick/mic; **real `onSystemResumed`** via `visibilitychange`.
2. **Bridge changes** (small, in `clients/traycer-cli/src/tailnet/`) — add `GET /discover` (relocate `enumerateTailnetHosts`); add `ACAO` to `/whoami` + `/healthz`; add `/authn/*` reverse-proxy (spike only).
3. **Web entry + gateway** — Vite `index.html` + `main.tsx` mounting gui-app with `WebRunnerHost`; serve PWA **same-origin with the authn proxy** via `tailscale serve` (port 443 on the chosen always-on machine — likely Plato).
4. **Mobile screens (Path B)** — Inbox, Epic chat (composer + approval cards + permission-mode toggle), read-only Changes; branch at the epic route on `useIsMobile`; never mount `TileCanvas`.
5. **Capacitor target** (`clients/mobile/`) — wrap the same web build; `MobileRunnerHost` with **native HTTP** (drops the proxy) + **native keychain** + `App`-resume `onSystemResumed`. Delete the gateway/proxy. Budget real time for the first device build (signing, pipeline) per the draft's §8.

**Throwaway toward Capacitor:** only the `/authn/*` proxy + PWA static serving. The bridge `/discover` + ACAO stay (they help desktop too).

---

## 6. Residual risks & not-yet-pinned items

- **nx workspace layout** — exact home of the web entry and `clients/mobile/` (Capacitor) not finalized. Mobile screens live *inside* gui-app (mobile route branch), not a separate package.
- **Spike serving host** — which always-on machine serves the PWA + authn proxy (default assumption: Plato, `tailscale serve` :443). It must be up for the spike; Capacitor removes this dependency.
- **Read-only diff renderer on mobile** — confirm `@pierre/diffs` (or a lighter renderer) is acceptable on a phone; it's the first cut if it fights.
- **Simplified composer vs protocol** — confirm `agent.sendMessage` accepts plain text without the Tiptap mention/slash machinery (expected yes; verify the send path).
- **Provider re-auth & shared account** (D4 caveats) — accepted limitations for v1.
- **No closed-app notifications** — there is **no push infra** (no web-push/FCM/APNs/service worker); notifications are local toasts while the app is open. "Agent needs you while closed" is a **backend/relay project**, not a shell feature — deferred. If/when wanted: build the relay first, then it's a Capacitor push-receive plugin (not Tauri).

---

## 7. TL;DR

Phone access = a third `IRunnerHost` impl + a thin mobile surface (Path B) that bypasses the desktop tile canvas. Reachability is genuinely done — the bridge runs and is reachable from a phone today (tested). The two things the draft under-rated: **authn CORS is a hard wall** (solve with native HTTP under Capacitor, or a same-origin proxy in a PWA spike), and **auto-discovery needs a new bridge `/discover` endpoint**. Build the **PWA spike** to validate fast, then ship **Capacitor** (direct native auth, native keychain, no infra). **Tauri is dropped; the terminal is out of v1; the home screen is an Inbox.**
