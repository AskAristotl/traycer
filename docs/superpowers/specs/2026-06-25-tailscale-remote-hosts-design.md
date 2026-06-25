# Tailscale Remote Hosts — Design

- **Date:** 2026-06-25
- **Status:** Approved (design); pending implementation plan
- **Repo:** `AskAristotl/traycer` (fork of `traycerai/traycer`)
- **Branch:** `feat/tailscale-remote-hosts`

## Context & problem

Traycer's renderer addresses a **host** — the per-machine binary that runs the
coding-agent harnesses — by a `HostDirectoryEntry.websocketUrl`. The transport
(`WsRpcClient` / `WsStreamClient`) is URL-agnostic: it dials whatever URL the
entry carries, and the data model already distinguishes `kind: "local"` from
`kind: "remote"` (`clients/shared/host-client/host-directory.ts`). Remote-host
support was pre-architected but deliberately deferred: `fetchRemoteHosts()` is a
stub returning `[]` (`clients/shared/host-client/remote-fetcher.ts`), and the
`remoteFetcher` is already threaded as a prop into `HostDirectoryService`
(`clients/gui-app/src/providers/host-runtime-provider.tsx:168`).

We want to reach a host running on **another of our own machines** over a
**Tailscale** tailnet. Tailscale (WireGuard) already provides NAT traversal,
transport encryption, device identity, and ACLs — so we do **not** build a
relay server. We supply a real `remoteFetcher`, a host-side bridge that exposes
the host over the tailnet, and a Settings UI to manage remote hosts.

### Hard constraint that shapes the design

The signed host binary **binds to `127.0.0.1`** and self-publishes
`ws://127.0.0.1:<port>/rpc` into `~/.traycer/host/pid.json`
(`clients/traycer-cli/src/host/pid-metadata.ts`, `.../store/paths.ts:22`). It is
a closed binary we cannot modify, so we cannot make it bind to the tailnet
interface. A host-side forwarder is therefore **required**, not optional.

## Goals (v1 scope)

- A remote host on the tailnet appears in the host picker with an online/offline
  + version badge.
- A **GUI chat** tab works against the remote host (agent runs).
- A **terminal** tab works against the remote host (PTY).
- A **Settings → Remote Hosts** panel: add by tailnet name, remove, see status.
- Manually-added hosts use the host's **real `hostId`** (see Key Decisions).

## Non-goals (v1)

- No relay/tunnel server (Tailscale is the transport).
- No automatic tailnet enumeration (hosts are added manually; auto-discovery is
  a possible later enhancement).
- No cross-account authorization work. Multi-person use is served by a **shared
  single account** (see "Accounts & authorization"); separate-account access is
  gated server-side and cannot be enabled from this fork.
- No changes to the closed host binary or the agent-harness integration.
- Inherited remote limitations are accepted and documented, not fixed:
  - OAuth provider re-auth on a remote host routes to the CLI
    (`provider-reauth-banner.tsx`).
  - "Open in editor" is local-filesystem-only.
  - A terminal tab dies if its remote host goes offline (bound-for-life,
    `AGENTS.md:80-90`).

## Key decisions

1. **Use the host's real `hostId`, fetched from the bridge's `/whoami`, not a
   synthetic id.** A machine can be *local* to you when you sit at it and
   *remote* when you don't. Tabs/artifacts persist `hostId` and are cloud-synced;
   a synthetic id would diverge from the same machine's local id and break
   clone-not-migrate and tab binding (`AGENTS.md:71-90`). The bridge reads the
   canonical id from `pid.json`.

2. **One MagicDNS HTTPS frontend (`tailscale serve`, port 443) — no custom
   ports.** Tailscale HTTPS issues a publicly-valid cert for
   `<host>.<tailnet>.ts.net`. The renderer dials `wss://<host>/rpc` and fetches
   `https://<host>/whoami`, both already permitted by the desktop CSP
   (`https:` / `wss:` in `content-security-policy.ts:30`) — **no CSP change, no
   port bookkeeping**. A host is added by its tailnet name alone.
   - *Fallback (not v1 default):* plaintext `tailscale serve --tcp` on a fixed
     port + probing from the Electron main process.

3. **Probe from the Electron main process, not the renderer.** Mirrors existing
   reachability code (`canReachHostWebsocketUrl`, host-readiness), avoids any CSP
   nuance, and works for the plaintext fallback. The actual `wss://` RPC/stream
   connection still runs in the renderer via the existing transport (Tailscale
   certs are publicly trusted).

4. **All participants share ONE Traycer account (shared-account model).** See
   "Accounts & authorization" below. The client's bearer is threaded into the WS
   open-frame and validated by the *remote* host (`ws-rpc-client.ts:184`); the
   host then applies **server-side team-backed role checks**
   (`request-context.ts:194-199`). A single shared account makes every
   client/host the same `userId` (owner role, full `canAct`), which is the only
   topology this fork can guarantee — cross-account authorization is enforced in
   the closed host/cloud and is out of our control.

## Accounts & authorization (multi-person)

Target use: three people (you, a colleague, a shared Mac Studio), each able to
reach the others' hosts. The **network** layer (Tailscale) handles N machines
trivially. The **authorization** layer does not, and it is decided server-side:

- The host verifies the bearer JWT, then runs **team-backed role checks**
  (`request-context.ts:194-199`); access is an org/team/role property
  (`role: "owner"|"viewer"`, `canAct` — `subscribe.ts:274-276`), and the host is
  "single-user today" (`provider-schemas.ts:103`). Enforcement is in the closed
  host + cloud, **not in this repo**.

Options, in order of certainty:

1. **Shared single account (chosen for v1).** All three sign into the *same*
   Traycer account on their devices. Every bearer/host is one `userId` → owner +
   `canAct`. The Tailscale design works unchanged; topology is just three
   machines each running the bridge, each addable as a remote host. Caveats: no
   per-person attribution; the "single-user today" host may show concurrency
   rough edges under simultaneous use; provider (Claude/Codex) auth stays
   per-machine regardless; sharing a seat is a Traycer-ToS gray area.
2. **Same Traycer Team/org (possible upgrade, unverified).** Preserves
   identities, but a connecting teammate may resolve to `viewer`/limited
   `canAct`, and host-connection behavior is server-enforced and not verifiable
   from this repo. May require a paid Team plan.
3. **Three independent accounts (not viable).** Tokens authenticate but have no
   shared role → server-side authz denies cross-host access.

## Architecture

```
Client machine (you)                          Host machine (on tailnet)
┌────────────────────────────┐                ┌─────────────────────────────────────┐
│ Settings → Remote Hosts     │  https (cert)  │ Traycer Tailnet Bridge (NEW)        │
│   add by tailnet name       │ ──/whoami────► │  • reads ~/.traycer/host/pid.json    │
│   ● online / version badge  │ ──/healthz───► │  • drives `tailscale serve` config   │
│                            │                │  • reconfigures on host respawn      │
│ remoteFetcher (real, NEW)   │   wss (cert)   │ ┌─────────────────────────────────┐ │
│   → HostDirectoryEntry[]     │ ──/rpc───────► │ │ tailscale serve (path routing)  │ │
│ existing WsRpcClient/Stream  │ ──/stream────► │ │  /whoami,/healthz → bridge       │ │
│ existing picker + binding    │                │ │  /rpc,/stream     → host :wsPort │ │
└────────────────────────────┘                │ └─────────────────────────────────┘ │
                                              │   signed host @ 127.0.0.1:<wsPort>   │
                                              └─────────────────────────────────────┘
```

## Components (five bounded units)

### 1. Host-side bridge — new `traycer` CLI subcommand
- **Location:** `clients/traycer-cli/src/` (new `tailnet-bridge` runtime module +
  commands).
- **Behavior:** reads `~/.traycer/host/pid.json` (reuse `readHostPidMetadata`);
  runs a tiny local HTTP server for `/whoami` (returns `hostId`, `version`) and
  `/healthz`; drives `tailscale serve` HTTPS path-routing so
  `/whoami`,`/healthz` → bridge and `/rpc`,`/stream` → host ws port; watches
  `pid.json` and reconfigures `serve` on host respawn (new port).
- **Install/uninstall** as launchd/systemd service by mirroring the existing
  `service-install.ts` / `service-status.ts` / `service-uninstall.ts`.
- **Depends on:** the `tailscale` CLI and `pid.json`. **Interface:** tailnet
  HTTPS endpoints. **Testable** with a fake `tailscale` exec + temp `pid.json`.

### 2. Remote-host config store — renderer
- **Location:** `clients/gui-app/src/stores/remote-hosts/`.
- Persisted Zustand store (`basePersistOptions` + new `STORE_KEYS` entry) holding
  `{ tailnetName, label, hostId, addedAt }[]`. Pure state, no I/O.

### 3. Electron-main remote probe + IPC — new
- **Location:** `clients/desktop/src/electron-main/host/remote-probe.ts`.
- `probeRemoteHost(tailnetName) → { reachable, hostId, version }` via Node
  `https GET /whoami|/healthz`. Exposed over the existing `runner-ipc.ts` bridge.

### 4. Real `remoteFetcher` — renderer
- **Location:** `clients/gui-app/src/lib/host/tailnet-remote-fetcher.ts`.
- Reads unit 2, calls unit 3 per host, returns `HostDirectoryEntry[]`
  (`kind:"remote"`, `websocketUrl:"wss://<name>/rpc"`, `status`, `version`).
- **Wire-in:** replace the `null`/stub `remoteFetcher` at the desktop mount that
  feeds `host-runtime-provider.tsx:168`. Downstream (picker, binding, transport)
  is unchanged.

### 5. Settings → Remote Hosts panel — renderer
- **Location:**
  `clients/gui-app/src/components/settings/panels/remote-hosts-settings-panel.tsx`.
- Add-by-tailnet-name (probes `/whoami` to capture canonical `hostId`), remove,
  and online/offline + version badges (periodic `/healthz`). Registered in the
  settings nav beside Providers/Host; mirrors `providers-settings-panel.tsx`.

## Data flow

1. **Add host:** user enters tailnet name → main probes `/whoami` → real
   `hostId` + version captured → saved to store.
2. **Refresh:** on start / periodically, `remoteFetcher` reads the store →
   main probes `/healthz` + `/whoami` per host → returns entries with `status`.
3. **Merge:** `HostDirectoryService` merges local + remote → picker shows the
   remote host with its badge.
4. **Connect:** select remote host → existing `bind()` → `WsRpcClient` dials
   `wss://<name>/rpc` → remote host validates bearer (same account) → chat +
   terminal work.
5. **Respawn:** host restarts on a new port → bridge reconfigures `tailscale
   serve` → `wss://<name>/rpc` keeps resolving (stable external surface).

## Error handling

- **Bridge:** `tailscale` missing / logged-out / `serve` failure → explicit CLI
  error + service logs; `pid.json` absent (host down) → retry/wait.
- **Probe unreachable:** entry stays in the list but flips to
  `status:"unavailable"` (offline badge) — never silently dropped.
- **`hostId` changed on re-probe** (host reinstalled) → surface a "host identity
  changed" warning; user re-confirms.
- **Bearer rejected** (wrong account) → existing `HostRpcError` surfaces with an
  auth hint in the panel.

## Assumptions & constraints

- All participants/devices are logged into **one shared Traycer account** (see
  "Accounts & authorization"). Separate-account access is out of scope.
- **Tailscale HTTPS / MagicDNS certs are enabled** on the tailnet (one-time
  admin-console toggle).
- The signed host binary binds `127.0.0.1` and is not modifiable.
- The fork tracks the upstream protocol; version negotiation is per-method, so
  modest client/host version skew degrades gracefully.

## Risks & de-risking

- **`tailscale serve` path-routing + WebSocket-upgrade proxying** is the
  load-bearing external assumption. **De-risk first:** validate a throwaway
  `serve` config that routes `/whoami` to a local HTTP server and `/rpc` to a
  local WS server, and confirm a `wss://` client round-trips, *before* building
  units on it.
- Tailscale HTTPS cert provisioning latency on first `serve` — acceptable;
  one-time per host.

## Testing strategy

- **Bridge runtime:** unit test with a fake `tailscale` exec + temp `pid.json`
  (assert serve args; reconfigure on pid change).
- **`remoteFetcher`:** unit test composing store + mocked probe → asserts entry
  shape/status (extends existing `host-directory-service.test.ts`).
- **Settings panel + main probe:** component/unit tests mirroring
  `providers-settings-panel.test.tsx`.
- **Acceptance (manual, two machines):** add host → open a GUI chat *and* a
  terminal tab against it.

## Acceptance criteria

1. From machine A, add machine B by its tailnet name; the panel shows B online
   with its version, using B's real `hostId`.
2. B appears in the host picker; selecting it binds without error.
3. A GUI chat on B runs an agent end-to-end.
4. A terminal tab on B attaches to a working PTY.
5. Restarting B's host (new port) does not break an existing `wss://B/rpc`
   binding after the bridge reconfigures.

## Out of scope / future

- Automatic tailnet enumeration (`tailscale status --json`).
- Cross-account host sharing + per-host ACL UX.
- Remote-aware fixes for OAuth re-auth and "open in editor".
- Plaintext `--tcp` fallback path (documented but not the v1 default).
