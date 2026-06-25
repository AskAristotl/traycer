# Tailscale Remote Hosts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Traycer desktop client reach a host running on another machine over a Tailscale tailnet — discovered automatically or added manually — and use it for GUI chat and terminal tabs.

**Architecture:** A host-side `traycer tailnet-bridge` process (installed as a per-user OS service) reads the local host's `~/.traycer/host/pid.json`, serves `/whoami` + `/healthz` on a loopback HTTP port, and runs `tailscale serve` (HTTPS, MagicDNS) to expose `/whoami,/healthz` → bridge and `/rpc,/stream` → the host's ws port. The client supplies a real `RemoteHostFetcher` (replacing the `null` stub at the desktop mount) that composes a persisted manual-host list with tailnet enumeration + reachability probing done in the Electron main process over a new IPC bridge surface, returning `kind:"remote"` `HostDirectoryEntry`s with `websocketUrl: "wss://<name>/rpc"`. Everything downstream (picker, binding, the versioned-RPC transport) is unchanged — the transport already dials remote `wss` URLs with no loopback assumption.

**Tech Stack:** TypeScript (strict), Bun workspaces + Nx, `node:` builtins (CLI runs under Node 20 in production), Commander (CLI), Zustand + persist (gui-app store), Electron IPC (`contextBridge`/`ipcMain.handle`), Vitest (globals:false), TanStack Router (settings routes), shadcn/ui, Tailscale CLI (`tailscale serve`, `tailscale status --json`).

## Global Constraints

Copied verbatim from the spec + repo style (`AGENTS.md`/`CLAUDE.md`). Every task implicitly includes these.

- **No `any`**, no unsafe assertions (`as any`, `as unknown`, `as unknown as`). Exception: preload `*-bridge.ts` files use `ipcRenderer.invoke(...) as Promise<T>` — match that local idiom only at the contextBridge seam.
- **No optional params** (`?:`) — use explicit `value: T | null` / `value: T | undefined`. **No default param values** — every arg passed explicitly by the caller.
- **kebab-case** filenames; `PascalCase` types/classes; `camelCase` functions; `UPPER_SNAKE_CASE` constants. Numeric literals use `_` separators (e.g. `65_535`).
- Import aliases: `@/*` (gui-app), `@traycer/protocol/*`, `@traycer-clients/shared/*`. Never `../../..` across packages.
- Catch only at boundaries (transport/IPC) where you can handle or add context. Never log secrets or user code.
- UI: no fixed px/rem layout sizes — use `w-full`/`max-w-*`/`%`/`clamp()`. Compose classes via `cn()` from `@/lib/utils`, never template-literal class strings. Use `MutedAgentSpinner`/`AgentSpinningDots`, never inline spinner markup.
- Host identity: `hostId ≡ deviceId`. Do NOT introduce a parallel `deviceId`. Remote entries must carry the host's **real** `hostId` (from `/whoami`).
- Type-check with the Nx-scoped target, never raw `tsc`: `bunx nx run <project>:compile`. `@traycer-clients/shared` has **no** `compile`/`test` target — it is type-checked transitively by consumers (run gui-app's compile).
- Lint forbids any warning (`eslint . --cache --fix --max-warnings 0`), applies to tests too, no `eslint-disable`.

## Interface Contract (shared names — all tasks MUST use these verbatim)

Defining these once prevents cross-task drift. Wherever a task references one of these, use the exact name/shape below.

**Bridge HTTP contract (host side ⇄ client probe):**
- `GET /whoami` → `200 application/json` body `{ "hostId": string, "version": string }`
- `GET /healthz` → `200 application/json` body `{ "ok": true }`
- Client reaches them at `https://<tailnetName>:<port>/whoami` and `https://<tailnetName>:<port>/healthz` via `tailscale serve` HTTPS.

**Bridge HTTPS port (tailnet-wide):**
- `export const TAILNET_BRIDGE_HTTPS_PORT = 8443;` — defined in `clients/shared/host-client/tailnet-remote.ts` (Task 2.1) and re-declared identically in `clients/desktop/src/ipc-contracts/remote-host-types.ts` (Task 2.3, since desktop main cannot import `@traycer-clients/shared`). Phase 0 chose **8443** as the single tailnet-wide port (443 can be occupied — this dev box runs `portless` on 443). The bridge `serve` command defaults to 8443 (`--https-port`); the client URL builders and probe/enumerate use the constant. Bridge default and client constant MUST stay equal.

**Remote host addressing:**
- `tailnetName` = a MagicDNS name, e.g. `studio.tailnet-xyz.ts.net` (no scheme, no port, no trailing dot).
- Remote RPC URL = `wss://<tailnetName>:${TAILNET_BRIDGE_HTTPS_PORT}/rpc` (the `/stream` URL is derived by the existing `toStreamDialUrl`).

**Shared TS types (exact):**
```ts
// clients/shared/host-client/tailnet-remote.ts
export interface TailnetWhoami {
  readonly hostId: string;
  readonly version: string;
}
export interface RemoteHostProbe {
  readonly reachable: boolean;
  readonly hostId: string | null;
  readonly version: string | null;
}
export interface DiscoveredRemoteHost {
  readonly tailnetName: string;
  readonly hostId: string;
  readonly version: string;
}
```

**Persisted store (gui-app):**
```ts
export interface ManualRemoteHost {
  readonly tailnetName: string;
  readonly label: string;
  readonly hostId: string;
  readonly addedAt: number;
}
// store state: { manualHosts: ReadonlyArray<ManualRemoteHost>;
//                disabledDiscovered: Readonly<Record<string, boolean>> }  // keyed by hostId
```

**IPC channels (desktop):**
- `RunnerHostInvoke.remoteHostsProbe = "runnerHost:remoteHosts:probe"` — arg `{ tailnetName: string }` → `RemoteHostProbe`
- `RunnerHostInvoke.remoteHostsEnumerate = "runnerHost:remoteHosts:enumerate"` — no arg → `readonly DiscoveredRemoteHost[]`

**Preload surface (desktop):**
```ts
export interface DesktopRemoteHostsBridge {
  readonly probe: (input: { readonly tailnetName: string }) => Promise<RemoteHostProbe>;
  readonly enumerate: () => Promise<readonly DiscoveredRemoteHost[]>;
}
// exposed as window.runnerHost.remoteHosts
```

**Settings section id:** `"remote-hosts"` (URL slug `/settings/remote-hosts`).

**CLI command:** `traycer tailnet-bridge serve | install | uninstall | status`.

**Bridge OS-service label id:** `ai.traycer.tailnet-bridge` (production); `ai.traycer.tailnet-bridge.<environment>` otherwise.

---

## Phase 0 — De-risk spike: validate `tailscale serve` (BLOCKING, no code committed)

The entire design rests on `tailscale serve` doing HTTPS path-routing to two backends AND proxying a WebSocket upgrade. Prove it on real hardware before building. This phase produces **findings**, not committed code.

### Task 0.1: Prove path-routing + ws-upgrade through `tailscale serve`

**Files:** none committed (scratch only).

- [ ] **Step 1: Stand up two throwaway local servers.** On a tailnet machine with `tailscale` up and HTTPS enabled, run a tiny Node script (scratch) that starts: (a) an HTTP server on `127.0.0.1:9101` answering `GET /whoami` → `{"hostId":"spike","version":"0"}`; (b) a WebSocket echo server on `127.0.0.1:9102` at path `/rpc`.

- [ ] **Step 2: Configure `tailscale serve` path-routing.** Try, in order, until one works (Tailscale CLI syntax varies by version — record the exact working form):

```bash
# Variant A (set-path mounts, modern CLI)
tailscale serve --bg --https=443 --set-path=/whoami http://127.0.0.1:9101
tailscale serve --bg --https=443 --set-path=/rpc     http://127.0.0.1:9102
# Variant B (positional, older CLI)
tailscale serve --bg https / proxy 127.0.0.1:9101            # fallback single-backend
# Inspect:
tailscale serve status
```

- [ ] **Step 3: Verify HTTPS routing + cert.** From a *second* tailnet machine:

```bash
curl -sS https://<machine>.<tailnet>.ts.net/whoami    # expect {"hostId":"spike","version":"0"} with a valid cert (no -k)
```

- [ ] **Step 4: Verify WebSocket upgrade survives the proxy.** From the second machine, open `wss://<machine>.<tailnet>.ts.net/rpc` with a one-line `websocat` or Node `ws` client and confirm an echo round-trips.

- [ ] **Step 5: Record the GO/NO-GO decision in the plan.** Append a short note under this task: the exact working `tailscale serve` argv, the CLI version, and whether ws-upgrade worked.
  - **GO:** ws round-trips through path-routed HTTPS → proceed with **Design A** (Phase 1 below as written; bridge only serves `/whoami`+`/healthz`, `tailscale serve` routes `/rpc,/stream` straight to the host port).
  - **NO-GO (path-routing or ws-upgrade fails):** switch to **Design B** — the bridge HTTP server becomes the single `tailscale serve` backend and itself reverse-proxies `/rpc,/stream` (handling the HTTP `upgrade` event with `node:http`/socket piping) to the host port. Only Task 1.3 changes (it configures one `tailscale serve / → bridgePort` mount) and Task 1.2 gains a ws-proxy responsibility. Note the switch here before continuing.

> Do not start Phase 1 until Task 0.1 has a recorded GO (Design A) or the NO-GO/Design-B note.

### Phase 0 RESULT (2026-06-25): ✅ GO — Design A

Validated on `dylans-macbook-pro.mercat-elver.ts.net` (Tailscale CLI 1.94.1 / daemon 1.98.5):
- `tailscale serve --bg --https=<PORT> --set-path=/<p> http://127.0.0.1:<port>/<p>` applies cleanly; `serve status` shows the path→backend table.
- Real Let's Encrypt cert issued for the MagicDNS name (`tailscale cert` + observed issuer `Let's Encrypt CN=YE2`).
- `GET /whoami` → `{"hostId":...,"version":...}`, `GET /healthz` → `{"ok":true}`.
- **`wss://<name>:<PORT>/rpc` upgrade echoed** — WebSocket survives the serve proxy. GO.
- **Path-in-target is required:** `--set-path=/whoami http://127.0.0.1:9101` (no path) STRIPS the mount and forwards to backend root (→ 404). The target MUST carry the path: `…9101/whoami`. The plan's `buildServeArgs` already does this — keep it.
- **Serve PORT must be configurable (default 443).** On a machine where another process owns `:443` (this dev box runs `portless proxy --port 443`), the bridge must serve on an alternate HTTPS port and the client must address `wss://<name>:<PORT>/rpc`. **Amendment:** Task 1.3 `buildServeArgs` takes `httpsPort` (default 443); Task 1.4 `serve` accepts `--https-port`; the client remote-host addressing (Tasks 2.1/2.6) carries an optional port and builds `wss://<name>[:<port>]/rpc`. Decide a tailnet-wide convention port across the three machines so discovery doesn't need a per-host port.

---

## Phase 1 — Host-side bridge (`@traycer-clients/traycer-cli`)

Independently shippable: at the end you can run `traycer tailnet-bridge serve` and `curl https://<machine>/whoami` from another tailnet machine. New tests live under `clients/traycer-cli/src/**/__tests__/`. Single-file run: `bunx vitest run --config vitest.config.ts <path>` from `clients/traycer-cli/`. Type-check: `bunx nx run @traycer-clients/traycer-cli:compile`.

### Task 1.1: Remote ws-port parser + whoami payload (pure util)

**Files:**
- Create: `clients/traycer-cli/src/tailnet/host-endpoint.ts`
- Test: `clients/traycer-cli/src/tailnet/__tests__/host-endpoint.test.ts`

**Interfaces:**
- Consumes: `readHostPidMetadata` (`clients/traycer-cli/src/host/pid-metadata.ts`), `HostPidMetadata`.
- Produces: `interface BridgeHostEndpoint { readonly hostId: string; readonly version: string; readonly wsPort: number }`; `function parseHostWsPort(websocketUrl: string): number | null`; `async function readBridgeHostEndpoint(environment: Environment | undefined): Promise<BridgeHostEndpoint | null>`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { parseHostWsPort } from "../host-endpoint";

describe("parseHostWsPort", () => {
  it("extracts the port from a local host ws url", () => {
    expect(parseHostWsPort("ws://127.0.0.1:4917/rpc")).toBe(4917);
  });
  it("returns null for a url with no port", () => {
    expect(parseHostWsPort("ws://127.0.0.1/rpc")).toBeNull();
  });
  it("returns null for an unparseable url", () => {
    expect(parseHostWsPort("not a url")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it; expect failure** (`Cannot find module '../host-endpoint'`).

Run: `bunx vitest run --config vitest.config.ts src/tailnet/__tests__/host-endpoint.test.ts`

- [ ] **Step 3: Implement.** Do NOT reuse `isValidLocalHostWebsocketUrl` (it hard-requires `127.0.0.1`/`/rpc` and is local-only); this parser only needs the port.

```ts
import type { Environment } from "../runner/environment";
import { readHostPidMetadata } from "../host/pid-metadata";

export interface BridgeHostEndpoint {
  readonly hostId: string;
  readonly version: string;
  readonly wsPort: number;
}

export function parseHostWsPort(websocketUrl: string): number | null {
  if (!URL.canParse(websocketUrl)) {
    return null;
  }
  const parsed = new URL(websocketUrl);
  if (parsed.port.length === 0) {
    return null;
  }
  const port = Number.parseInt(parsed.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }
  return port;
}

export async function readBridgeHostEndpoint(
  environment: Environment | undefined,
): Promise<BridgeHostEndpoint | null> {
  const meta = await readHostPidMetadata(environment);
  if (meta === null) {
    return null;
  }
  const wsPort = parseHostWsPort(meta.websocketUrl);
  if (wsPort === null) {
    return null;
  }
  return { hostId: meta.hostId, version: meta.version, wsPort };
}
```

- [ ] **Step 4: Run tests; expect PASS.** Then add a test for `readBridgeHostEndpoint` returning `null` when `readHostPidMetadata` returns `null` by pointing `HOME` at an empty temp dir (mirror cli test fixtures that set `process.env.HOME`).

- [ ] **Step 5: Commit.**

```bash
git add clients/traycer-cli/src/tailnet/host-endpoint.ts clients/traycer-cli/src/tailnet/__tests__/host-endpoint.test.ts
git commit -m "feat(cli): parse host ws port + read bridge host endpoint"
```

### Task 1.2: Bridge HTTP server (`/whoami`, `/healthz`)

**Files:**
- Create: `clients/traycer-cli/src/tailnet/bridge-http-server.ts`
- Test: `clients/traycer-cli/src/tailnet/__tests__/bridge-http-server.test.ts`

**Interfaces:**
- Consumes: `BridgeHostEndpoint`, `readBridgeHostEndpoint` (Task 1.1).
- Produces: `interface BridgeHttpServer { readonly port: number; close(): Promise<void> }`; `async function startBridgeHttpServer(options: { readonly environment: Environment | undefined; readonly host: string; readonly port: number }): Promise<BridgeHttpServer>`. Binds `127.0.0.1`. `port: 0` → ephemeral; the chosen port is read back via `.port`. Each request re-reads the endpoint so a host respawn (new hostId/version) is reflected live.

- [ ] **Step 1: Write the failing test** (start on ephemeral port, fetch both routes):

```ts
import { describe, expect, it } from "vitest";
import { startBridgeHttpServer } from "../bridge-http-server";

describe("bridge-http-server", () => {
  it("serves /healthz", async () => {
    const server = await startBridgeHttpServer({ environment: undefined, host: "127.0.0.1", port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });
});
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement with `node:http`** (NOT Bun.serve — must run under Node 20):

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Environment } from "../runner/environment";
import { readBridgeHostEndpoint } from "./host-endpoint";

export interface BridgeHttpServer {
  readonly port: number;
  close(): Promise<void>;
}

export interface StartBridgeHttpServerOptions {
  readonly environment: Environment | undefined;
  readonly host: string;
  readonly port: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

async function handle(
  environment: Environment | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = req.url ?? "";
  if (url === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url === "/whoami") {
    const endpoint = await readBridgeHostEndpoint(environment);
    if (endpoint === null) {
      sendJson(res, 503, { error: "host-not-running" });
      return;
    }
    sendJson(res, 200, { hostId: endpoint.hostId, version: endpoint.version });
    return;
  }
  sendJson(res, 404, { error: "not-found" });
}

export function startBridgeHttpServer(
  options: StartBridgeHttpServerOptions,
): Promise<BridgeHttpServer> {
  const server = createServer((req, res) => {
    void handle(options.environment, req, res).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal" });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("bridge server bound to a non-TCP address"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((res2, rej2) => {
            server.close((err) => (err === undefined || err === null ? res2() : rej2(err)));
          }),
      });
    });
  });
}
```

- [ ] **Step 4: Add a `/whoami` test** that seeds a fake `pid.json` under a temp `HOME` (write `{pid, hostId, version, websocketUrl:"ws://127.0.0.1:5000/rpc", startedAt}`) and asserts the JSON body is `{ hostId, version }`. Run; expect PASS.

- [ ] **Step 5 (Design B only):** if Phase 0 was NO-GO, also handle the HTTP `upgrade` event here: on `server.on("upgrade", ...)` for paths `/rpc` and `/stream`, open a `net.connect(hostWsPort)` and pipe both sockets. Add a test that an upgrade to `/rpc` connects to a local echo socket. (Skip entirely under Design A.)

- [ ] **Step 6: Commit.**

```bash
git add clients/traycer-cli/src/tailnet/bridge-http-server.ts clients/traycer-cli/src/tailnet/__tests__/bridge-http-server.test.ts
git commit -m "feat(cli): bridge http server serving /whoami and /healthz"
```

### Task 1.3: `tailscale serve` configurator

**Files:**
- Create: `clients/traycer-cli/src/tailnet/serve-config.ts`
- Test: `clients/traycer-cli/src/tailnet/__tests__/serve-config.test.ts`

**Interfaces:**
- Consumes: `runCommand` from `../service/process-runner` (promisified `execFile`), `RunResult`/`RunOptions`.
- Produces: `function buildServeArgs(input: { readonly httpsPort: number; readonly bridgePort: number; readonly hostWsPort: number }): readonly string[][]` (one argv per `tailscale serve` mount; serve form validated in Phase 0: `["serve","--bg",`--https=${httpsPort}`,`--set-path=/whoami`,`${bridge}/whoami`]`); `async function applyServeConfig(input: { readonly httpsPort: number; readonly bridgePort: number; readonly hostWsPort: number; readonly run: ServeRunner }): Promise<void>`; `async function resetServeConfig(input: { readonly run: ServeRunner }): Promise<void>`; `type ServeRunner = (args: readonly string[]) => Promise<RunResult>`. Inject `ServeRunner` so tests use a fake (no real `tailscale`). **`httpsPort` default is 8443** (the tailnet-wide bridge port — Phase 0 chose 8443 because 443 can be occupied; threaded explicitly, no default param).

- [ ] **Step 1: Write the failing test** (fake runner records argv):

```ts
import { describe, expect, it } from "vitest";
import { applyServeConfig, buildServeArgs } from "../serve-config";

describe("serve-config", () => {
  it("builds a serve mount for each backend (Design A)", () => {
    const args = buildServeArgs({ httpsPort: 8443, bridgePort: 41999, hostWsPort: 4917 });
    const flat = args.map((a) => a.join(" "));
    expect(flat.some((a) => a.includes("/whoami") && a.includes("41999"))).toBe(true);
    expect(flat.some((a) => a.includes("/rpc") && a.includes("4917"))).toBe(true);
  });

  it("invokes the runner once per mount", async () => {
    const calls: string[][] = [];
    await applyServeConfig({
      httpsPort: 8443,
      bridgePort: 41999,
      hostWsPort: 4917,
      run: async (a) => {
        calls.push([...a]);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    expect(calls.length).toBe(buildServeArgs({ httpsPort: 8443, bridgePort: 41999, hostWsPort: 4917 }).length);
  });
});
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement** (fill `buildServeArgs` with the argv form validated in Task 0.1; the shape below assumes Variant A):

```ts
import type { RunResult } from "../service/process-runner";

export type ServeRunner = (args: readonly string[]) => Promise<RunResult>;

export function buildServeArgs(input: {
  readonly httpsPort: number;
  readonly bridgePort: number;
  readonly hostWsPort: number;
}): readonly string[][] {
  const https = `--https=${input.httpsPort}`;
  const bridge = `http://127.0.0.1:${input.bridgePort}`;
  const host = `http://127.0.0.1:${input.hostWsPort}`;
  return [
    ["serve", "--bg", https, "--set-path=/whoami", `${bridge}/whoami`],
    ["serve", "--bg", https, "--set-path=/healthz", `${bridge}/healthz`],
    ["serve", "--bg", https, "--set-path=/rpc", `${host}/rpc`],
    ["serve", "--bg", https, "--set-path=/stream", `${host}/stream`],
  ];
}

export async function applyServeConfig(input: {
  readonly httpsPort: number;
  readonly bridgePort: number;
  readonly hostWsPort: number;
  readonly run: ServeRunner;
}): Promise<void> {
  for (const args of buildServeArgs({
    httpsPort: input.httpsPort,
    bridgePort: input.bridgePort,
    hostWsPort: input.hostWsPort,
  })) {
    await input.run(args);
  }
}

export async function resetServeConfig(input: { readonly run: ServeRunner }): Promise<void> {
  await input.run(["serve", "reset"]);
}
```

Provide a real `ServeRunner` factory (used by the command, not the tests) that wraps `service/process-runner` `runCommand("tailscale", args, { env: undefined, cwd: undefined, timeoutMs: 15_000, tolerateNonZeroExit: true })`. Use `tolerateNonZeroExit: true` so a benign non-zero exit (e.g. `serve reset` with nothing configured, or a transient `tailscale` hiccup) returns a `RunResult` instead of rejecting — the bridge runtime (Task 1.4) inspects `exitCode`/`stderr` and logs rather than crashing. Put it in the same file as `export function tailscaleServeRunner(): ServeRunner`.

- [ ] **Step 4: Run tests; expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add clients/traycer-cli/src/tailnet/serve-config.ts clients/traycer-cli/src/tailnet/__tests__/serve-config.test.ts
git commit -m "feat(cli): tailscale serve configurator (path-routed https)"
```

### Task 1.4: Bridge runtime loop + `tailnet-bridge serve` command

**Files:**
- Create: `clients/traycer-cli/src/tailnet/bridge-runtime.ts`
- Create: `clients/traycer-cli/src/commands/tailnet-bridge-serve.ts`
- Modify: `clients/traycer-cli/src/index.ts` (register the long-running command — see Task 1.6)
- Test: `clients/traycer-cli/src/tailnet/__tests__/bridge-runtime.test.ts`

**Interfaces:**
- Consumes: `startBridgeHttpServer` (1.2), `applyServeConfig`/`resetServeConfig`/`tailscaleServeRunner` (1.3), `readBridgeHostEndpoint` (1.1).
- Produces: `async function runTailnetBridge(options: { readonly httpsPort: number; readonly environment: Environment | undefined; readonly pollIntervalMs: number; readonly run: ServeRunner; readonly signal: AbortSignal }): Promise<void>` — starts the HTTP server (on an ephemeral loopback `bridgePort`), applies serve config (`{ httpsPort, bridgePort, hostWsPort, run }`), then polls `readBridgeHostEndpoint` every `pollIntervalMs`; when `wsPort` changes it re-applies serve config; on `signal` abort it resets serve config and closes the server. This is the long-lived foreground worker (mirror `monitor.ts`: it does NOT go through `runCommand`/the runner envelope).

- [ ] **Step 1: Write the failing test** — drive one reconcile cycle with a fake runner + fast poll + an `AbortController`, asserting serve config is applied at least once and reset on abort. Seed a fake `pid.json` under temp `HOME`.

```ts
import { describe, expect, it } from "vitest";
import { runTailnetBridge } from "../bridge-runtime";
// ...seed temp HOME with pid.json (helper), then:
it("applies serve config on start and resets on abort", async () => {
  const calls: string[][] = [];
  const ac = new AbortController();
  const run = async (a: readonly string[]) => {
    calls.push([...a]);
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  const done = runTailnetBridge({ httpsPort: 8443, environment: undefined, pollIntervalMs: 10, run, signal: ac.signal });
  await new Promise((r) => setTimeout(r, 50));
  ac.abort();
  await done;
  expect(calls.some((c) => c.join(" ").includes("/rpc"))).toBe(true);
  expect(calls.some((c) => c.join(" ").includes("--https=8443"))).toBe(true);
  expect(calls.some((c) => c.join(" ").includes("reset"))).toBe(true);
});
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement `bridge-runtime.ts`.** Loop: read endpoint → if `null`, log to stderr and keep polling (host not up yet); if `wsPort` changed since last apply, `applyServeConfig`. **Resilience (spec: "serve failure → explicit CLI error + service logs", "pid.json absent → retry/wait"):** wrap each `applyServeConfig`/`resetServeConfig` call in try/catch — on failure, write the error to `process.stderr` and continue the loop (retry on the next poll) rather than letting it reject out of the long-lived worker; the worker only exits on `signal` abort. Honor `signal` (resolve the poll sleep early on abort, then best-effort `resetServeConfig` + `httpServer.close()`, each guarded). Log lifecycle lines to `process.stderr` (data-on-stdout convention does not apply; the bridge has no stdout data — diagnostics to stderr only).

- [ ] **Step 4: Implement the command** `commands/tailnet-bridge-serve.ts`:

```ts
import { runTailnetBridge } from "../tailnet/bridge-runtime";
import { tailscaleServeRunner } from "../tailnet/serve-config";
import type { Environment } from "../runner/environment";

export interface TailnetBridgeServeArgs {
  readonly httpsPort: number;
  readonly environment: Environment | undefined;
  readonly pollIntervalMs: number;
}

export async function runTailnetBridgeServe(args: TailnetBridgeServeArgs): Promise<void> {
  const ac = new AbortController();
  const onSignal = (): void => ac.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  await runTailnetBridge({
    httpsPort: args.httpsPort,
    environment: args.environment,
    pollIntervalMs: args.pollIntervalMs,
    run: tailscaleServeRunner(),
    signal: ac.signal,
  });
}
```

- [ ] **Step 5: Run tests; expect PASS.** Manual check (on a tailnet box): `bun run src/index.ts tailnet-bridge serve` then from another machine `curl https://<machine>/whoami`.

- [ ] **Step 6: Commit.**

```bash
git add clients/traycer-cli/src/tailnet/bridge-runtime.ts clients/traycer-cli/src/commands/tailnet-bridge-serve.ts clients/traycer-cli/src/tailnet/__tests__/bridge-runtime.test.ts
git commit -m "feat(cli): tailnet-bridge serve runtime + command"
```

### Task 1.5: Bridge OS-service install/uninstall/status

**Files:**
- Create: `clients/traycer-cli/src/tailnet/bridge-service.ts`
- Create: `clients/traycer-cli/src/commands/tailnet-bridge-service.ts`
- Test: `clients/traycer-cli/src/tailnet/__tests__/bridge-service.test.ts`

**Interfaces:**
- Consumes: `createServiceController`, `ServiceLabel`, `resolveServiceCliInvocation`, `CliInvocation` from `../service/*`; `withCliLock`.
- Produces: `function bridgeServiceLabelFor(environment: Environment): ServiceLabel` (id `ai.traycer.tailnet-bridge[.<env>]`, displayName `Traycer Tailnet Bridge[ (<Env>)]`); `function buildBridgeServiceInstallCommand(args: { readonly enableLinger: boolean; readonly allowSelfInvocation: boolean }): CommandFn`; `const bridgeServiceUninstallCommand: CommandFn`; `const bridgeServiceStatusCommand: CommandFn`. Install passes `cli` whose trailing args are `["tailnet-bridge", "serve"]`.

- [ ] **Step 1: Write the failing test** — assert `bridgeServiceLabelFor("production").id === "ai.traycer.tailnet-bridge"` and `bridgeServiceLabelFor("staging").id === "ai.traycer.tailnet-bridge.staging"`. (Mirror `service/label.ts` scheme exactly.)

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement `bridge-service.ts`.** **Platform scope: macOS (launchd) + Linux (systemd) only.** Do NOT reuse the shared controller on Windows: `windowsTaskName()` ignores `label.id` and always returns `\\Traycer\\Host` (label.ts:74-76), so a bridge Scheduled Task would collide with the host's, and `serviceManifestPath` returns `""` on win32 (label.ts:64-67), breaking install-state detection. At the top of install/uninstall/status, guard `if (os.platform() === "win32") throw cliError({ code: CLI_ERROR_CODES.SERVICE_UNSUPPORTED_PLATFORM, message: "The tailnet bridge service is supported on macOS and Linux only.", details: null, exitCode: 1 })`. Then reuse the existing `createServiceController()` (launchd/systemd). Build `InstallServiceOptions` with `label: bridgeServiceLabelFor(env)`, `cli: { command, args: [...resolved.args, "tailnet-bridge", "serve"] }` from `resolveServiceCliInvocation`, `enableLinger`. The install command mirrors `commands/service-install.ts` (wrap in `withCliLock`, `ctx.progress(...)`).
  - **Liveness gotcha:** the shared `ServiceController.status()` reads the *host's* `pid.json` + `isProcessAlive` — wrong for the bridge. For `bridgeServiceStatusCommand`, do NOT use `controller.status()`. Instead report `installed` by checking `serviceManifestPath(bridgeServiceLabelFor(env))` exists (via `node:fs`), and report `reachable` by `fetch("http://127.0.0.1:<bridgePort>/healthz")` only if you also persist the chosen bridge port. Simplest v1: status reports `{ installed: boolean }` from manifest existence only; defer port-based liveness. Document this in the command's `human` output ("installed; run from another machine to verify reachability").
  - **PATH gotcha (macOS launchd):** the bridge plist must include the system PATH floor so `tailscale` is found. The existing service plist already injects `hostAgentPath()` (which contains `/opt/homebrew/bin:/usr/local/bin`). Because the bridge reuses `createServiceController().install`, it inherits the same plist `EnvironmentVariables.PATH` — verify by reading `service/platforms/macos.ts buildPlist`; if PATH is host-specific, add a bridge variant. (It uses `hostAgentPath()` which is generic — reuse is fine.)

- [ ] **Step 4: Implement the command file** `commands/tailnet-bridge-service.ts` exporting `buildBridgeServiceInstallCommand`, `bridgeServiceUninstallCommand`, `bridgeServiceStatusCommand` (mirror `service-install.ts`/`service-uninstall.ts`/`service-status.ts` shapes, returning `{ data, human, exitCode: 0 }`).

- [ ] **Step 5: Run tests; expect PASS.**

- [ ] **Step 6: Commit.**

```bash
git add clients/traycer-cli/src/tailnet/bridge-service.ts clients/traycer-cli/src/commands/tailnet-bridge-service.ts clients/traycer-cli/src/tailnet/__tests__/bridge-service.test.ts
git commit -m "feat(cli): tailnet-bridge service install/uninstall/status"
```

### Task 1.6: Register the `tailnet-bridge` command group

**Files:**
- Modify: `clients/traycer-cli/src/index.ts` (add `registerTailnetBridgeCommands(program)` + call it from `registerCommands()`)

**Interfaces:**
- Consumes: `runTailnetBridgeServe` (1.4); `buildBridgeServiceInstallCommand`, `bridgeServiceUninstallCommand`, `bridgeServiceStatusCommand` (1.5); `withRunner`, `addRunnerFlags`, `config`.

- [ ] **Step 1: Add the registrar.** `serve` is long-running → register with `addRunnerFlags(cmd).action(...)` + own try/catch + `process.exit` (mirror `registerMonitorCommand`, index.ts:1210-1239). `install`/`uninstall`/`status` → `withRunner` (mirror `registerServiceCommands`, index.ts:549-586). **Do not name any option `--version`** (collides with the program version flag).

```ts
function registerTailnetBridgeCommands(program: Command): void {
  const bridge = program
    .command("tailnet-bridge")
    .description("Expose this machine's Traycer host over the tailnet via tailscale serve");

  addRunnerFlags(
    bridge
      .command("serve")
      .description("Run the bridge in the foreground (used by the OS service)")
      .option("--https-port <port>", "Tailnet HTTPS port for tailscale serve", "8443")
      .option("--poll-interval-ms <ms>", "How often to re-check the host port", "1000"),
  ).action(async (opts: Record<string, unknown>) => {
    try {
      await runTailnetBridgeServe({
        httpsPort:
          typeof opts.httpsPort === "string" ? Number.parseInt(opts.httpsPort, 10) : 8443,
        environment: config.environment,
        pollIntervalMs:
          typeof opts.pollIntervalMs === "string" ? Number.parseInt(opts.pollIntervalMs, 10) : 1000,
      });
      process.exit(0);
    } catch (err) {
      process.stderr.write(
        `[traycer tailnet-bridge] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
  });

  withRunner(
    bridge
      .command("install")
      .description("Install the tailnet bridge as a per-user OS service")
      .option("--no-linger", "Do not enable systemd linger (Linux)")
      .option("--allow-self-invocation", "Allow running the current binary directly"),
    (opts) =>
      buildBridgeServiceInstallCommand({
        enableLinger: opts.linger !== false,
        allowSelfInvocation: opts.allowSelfInvocation === true,
      }),
  );
  withRunner(bridge.command("uninstall").description("Remove the tailnet bridge service"), () => bridgeServiceUninstallCommand);
  withRunner(bridge.command("status").description("Show tailnet bridge service status"), () => bridgeServiceStatusCommand);
}
```

- [ ] **Step 2: Call it** from `registerCommands()` (near index.ts:258, beside the other `registerXCommands(program)` calls).

- [ ] **Step 3: Type-check.** Run: `bunx nx run @traycer-clients/traycer-cli:compile` → expect no errors.

- [ ] **Step 4: Smoke test the wiring.** `bun run src/index.ts tailnet-bridge --help` lists `serve`, `install`, `uninstall`, `status`.

- [ ] **Step 5: Commit.**

```bash
git add clients/traycer-cli/src/index.ts
git commit -m "feat(cli): register tailnet-bridge command group"
```

---

## Phase 2 — Client remote-host support (`shared` + `gui-app` + `desktop`)

Builds the discovery/probe path, the persisted config, the Settings UI, and wires a real `RemoteHostFetcher` at the desktop mount. Testable with mocks; end-to-end needs a bridge from Phase 1.

### Task 2.1: Shared remote types + remote entry mapper

**Files:**
- Create: `clients/shared/host-client/tailnet-remote.ts`
- Test: `clients/gui-app/src/lib/host/__tests__/tailnet-remote.test.ts` (shared has no test target; exercise it from gui-app)

**Interfaces:**
- Consumes: `HostDirectoryEntry`, `HostAvailability` (`clients/shared/host-client/host-directory.ts`).
- Produces: the three interfaces from the Interface Contract (`TailnetWhoami`, `RemoteHostProbe`, `DiscoveredRemoteHost`) + `export const TAILNET_BRIDGE_HTTPS_PORT = 8443;` + `function normalizeTailnetName(raw: string): string` (trim, strip trailing `.`, lowercase) + `function toRemoteDirectoryEntry(input: { readonly tailnetName: string; readonly hostId: string; readonly label: string; readonly version: string | null; readonly status: HostAvailability }): HostDirectoryEntry` building `websocketUrl: `wss://${tailnetName}:${TAILNET_BRIDGE_HTTPS_PORT}/rpc``, `kind: "remote"`. `toRemoteDirectoryEntry` reads the constant — no port param (single tailnet-wide port).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { normalizeTailnetName, toRemoteDirectoryEntry } from "@traycer-clients/shared/host-client/tailnet-remote";

describe("tailnet-remote", () => {
  it("normalizes a magicdns name", () => {
    expect(normalizeTailnetName("  Studio.Tailnet.ts.net.  ")).toBe("studio.tailnet.ts.net");
  });
  it("builds a wss /rpc remote entry with the real hostId", () => {
    const entry = toRemoteDirectoryEntry({
      tailnetName: "studio.tailnet.ts.net",
      hostId: "host-abc",
      label: "Mac Studio",
      version: "1.2.3",
      status: "available",
    });
    expect(entry).toEqual({
      hostId: "host-abc",
      label: "Mac Studio",
      kind: "remote",
      websocketUrl: "wss://studio.tailnet.ts.net:8443/rpc",
      version: "1.2.3",
      status: "available",
    });
  });
});
```

- [ ] **Step 2: Run; expect failure.** Run: `bunx vitest run --config vitest.config.ts src/lib/host/__tests__/tailnet-remote.test.ts` (from `clients/gui-app/`).

- [ ] **Step 3: Implement `tailnet-remote.ts`** per the Interface Contract types + the two functions.

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add clients/shared/host-client/tailnet-remote.ts clients/gui-app/src/lib/host/__tests__/tailnet-remote.test.ts
git commit -m "feat(shared): tailnet remote types + remote directory entry mapper"
```

### Task 2.2: Persisted remote-hosts store

**Files:**
- Modify: `clients/gui-app/src/lib/persist/keys.ts` (add `PERSIST_STORES` entry)
- Modify (optional): `clients/gui-app/src/lib/persist/__tests__/keys.test.ts` (add a `persistKey("remote-hosts")` assertion to match the per-store discipline; not required to pass the build)
- Create: `clients/gui-app/src/stores/remote-hosts/remote-hosts-store.ts`
- Test: `clients/gui-app/src/stores/remote-hosts/__tests__/remote-hosts-store.test.ts`

**Interfaces:**
- Consumes: `basePersistOptions`, `persistKey`, `STORE_KEYS` (`@/lib/persist`); `ManualRemoteHost` (Interface Contract).
- Produces: `useRemoteHostsStore` with state `{ manualHosts: ReadonlyArray<ManualRemoteHost>; disabledDiscovered: Readonly<Record<string, boolean>>; addManualHost(host: ManualRemoteHost): void; removeManualHost(hostId: string): void; setDiscoveredDisabled(hostId: string, disabled: boolean): void }`. Selectors `manualHostsOf(state)`, `isDiscoveredDisabled(state, hostId)` exported as standalone functions.

- [ ] **Step 1: Add the catalog entry** to `PERSIST_STORES` in `keys.ts`: `{ camelName: "remoteHosts", leaf: "remote-hosts", kind: "static" }`. `keys.test.ts` does NOT hold a transcribed catalog table — it has per-store `persistKey("<leaf>")` assertions plus a unique-leaf check (`keys.test.ts:119-121`) that auto-covers the new leaf, so no test row is strictly required. Optionally add `expect(persistKey(STORE_KEYS.remoteHosts)).toBe(persistKey("remote-hosts"))` to match the existing per-store discipline. Run `bunx nx run @traycer-clients/gui-app:compile` to confirm `STORE_KEYS.remoteHosts` now type-checks.

- [ ] **Step 2: Write the failing store test** (mirror `host-directory-service.test.ts` style — `import { describe, expect, it } from "vitest"`, no `vi`). Reset via `useRemoteHostsStore.setState`.

```ts
import { describe, expect, it } from "vitest";
import { useRemoteHostsStore } from "../remote-hosts-store";

describe("useRemoteHostsStore", () => {
  it("adds and removes a manual host by hostId", () => {
    useRemoteHostsStore.setState({ manualHosts: [], disabledDiscovered: {} });
    useRemoteHostsStore.getState().addManualHost({
      tailnetName: "studio.tailnet.ts.net",
      label: "Studio",
      hostId: "h1",
      addedAt: 1,
    });
    expect(useRemoteHostsStore.getState().manualHosts).toHaveLength(1);
    useRemoteHostsStore.getState().removeManualHost("h1");
    expect(useRemoteHostsStore.getState().manualHosts).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run; expect failure.**

- [ ] **Step 4: Implement the store** (mirror `local-snapshot-clear-store.ts`: `create<State>()(persist(...))`, immutable updates, no-op guards, `Pick<>` partialize over `manualHosts` + `disabledDiscovered`, `...basePersistOptions(persistKey(STORE_KEYS.remoteHosts))`). `addManualHost` de-dupes by `hostId` (replace existing). Export the two selector helpers below the store.

- [ ] **Step 5: Run; expect PASS.**

- [ ] **Step 6: Commit.**

```bash
git add clients/gui-app/src/lib/persist/keys.ts clients/gui-app/src/lib/persist/__tests__/keys.test.ts clients/gui-app/src/stores/remote-hosts/remote-hosts-store.ts clients/gui-app/src/stores/remote-hosts/__tests__/remote-hosts-store.test.ts
git commit -m "feat(gui-app): persisted remote-hosts store"
```

### Task 2.3: Electron-main probe + enumeration

**Files:**
- Create: `clients/desktop/src/ipc-contracts/remote-host-types.ts`
- Create: `clients/desktop/src/electron-main/host/remote-probe.ts`
- Test: `clients/desktop/src/electron-main/host/__tests__/remote-probe.test.ts`

**Interfaces:**
- Consumes: `node:https`, `node:child_process` (for `tailscale status --json`); the JSON shapes from the Interface Contract (`RemoteHostProbe`, `DiscoveredRemoteHost`, `TailnetWhoami`) and the port constant. Desktop main is CommonJS and cannot import `@traycer-clients/shared` — **re-declare** these shapes locally in `ipc-contracts/` (mirror the `DesktopLocalHostSnapshot` duplication rule) as `RemoteHostProbe`/`DiscoveredRemoteHost` plus `export const TAILNET_BRIDGE_HTTPS_PORT = 8443;` in `clients/desktop/src/ipc-contracts/remote-host-types.ts` (kept equal to the shared constant by hand).
- Produces: `async function probeRemoteHost(input: { readonly tailnetName: string }): Promise<RemoteHostProbe>` (HTTPS GET `https://<name>:${TAILNET_BRIDGE_HTTPS_PORT}/whoami` with a 750ms timeout; parse `{hostId,version}`; on any failure → `{ reachable: false, hostId: null, version: null }`); `async function enumerateTailnetHosts(): Promise<readonly DiscoveredRemoteHost[]>` (run `tailscale status --json`, take online peers' `DNSName`, `probeRemoteHost` each in parallel, keep the reachable ones with a `hostId`). Inject the exec + fetch via params defaulting-free overloads — pass a `deps` object so tests supply fakes.

- [ ] **Step 1: Create `ipc-contracts/remote-host-types.ts`** with the re-declared `RemoteHostProbe` + `DiscoveredRemoteHost` (plain-data, `readonly` fields) and `export const TAILNET_BRIDGE_HTTPS_PORT = 8443;`. Keep structurally identical to the shared versions by hand.

- [ ] **Step 2: Write the failing test** for `probeRemoteHost` using an injected fake fetcher:

```ts
import { describe, expect, it } from "vitest";
import { probeRemoteHostWith } from "../remote-probe";

describe("probeRemoteHost", () => {
  it("maps a good /whoami to reachable", async () => {
    const result = await probeRemoteHostWith(
      { tailnetName: "studio.ts.net" },
      { getWhoami: async () => ({ hostId: "h1", version: "1.0.0" }) },
    );
    expect(result).toEqual({ reachable: true, hostId: "h1", version: "1.0.0" });
  });
  it("maps a failure to unreachable", async () => {
    const result = await probeRemoteHostWith(
      { tailnetName: "studio.ts.net" },
      { getWhoami: async () => { throw new Error("nope"); } },
    );
    expect(result).toEqual({ reachable: false, hostId: null, version: null });
  });
});
```

- [ ] **Step 3: Run; expect failure.**

- [ ] **Step 4: Implement.** Split into a testable core (`probeRemoteHostWith(input, deps)` where `deps.getWhoami: (name) => Promise<TailnetWhoami>`) and a thin `probeRemoteHost(input)` that supplies the real `node:https` GET to `https://${input.tailnetName}:${TAILNET_BRIDGE_HTTPS_PORT}/whoami` (mirror `canReachHostWebsocketUrl`'s single-`settle` + timeout discipline, but do an actual HTTPS GET and JSON-parse the body, validating `typeof hostId === "string"`). `enumerateTailnetHosts` likewise probes each peer at the same port via the same `probeRemoteHost`. Same pattern for `enumerateTailnetHosts` / `enumerateTailnetHostsWith(deps)` where `deps.tailscaleStatusJson: () => Promise<string>` and `deps.probe: (name) => Promise<RemoteHostProbe>`. Parse `tailscale status --json` defensively: read `Peer` map values, keep entries with `Online === true` and a string `DNSName`, normalize the name (strip trailing `.`).

- [ ] **Step 5: Add an `enumerateTailnetHostsWith` test** with a fake status JSON (two peers, one offline) + a fake probe → asserts only the online+reachable peer is returned. Run; expect PASS.

- [ ] **Step 6: Commit.**

```bash
git add clients/desktop/src/ipc-contracts/remote-host-types.ts clients/desktop/src/electron-main/host/remote-probe.ts clients/desktop/src/electron-main/host/__tests__/remote-probe.test.ts
git commit -m "feat(desktop): main-process remote host probe + tailnet enumeration"
```

### Task 2.4: IPC bridge surface for remote hosts

**Files:**
- Modify: `clients/desktop/src/ipc-contracts/ipc-channels.ts` (add two `RunnerHostInvoke` keys)
- Create: `clients/desktop/src/electron-main/ipc/remote-hosts-ipc.ts` (`registerRemoteHostsIpc(bridge)`)
- Modify: `clients/desktop/src/electron-main/ipc/runner-ipc-bridge.ts` (call `registerRemoteHostsIpc(this)` in `install()`)
- Create: `clients/desktop/src/electron-preload/remote-hosts-bridge.ts` (`buildRemoteHostsBridge()`)
- Modify: `clients/desktop/src/electron-preload/preload-bridge.ts` (add `remoteHosts: buildRemoteHostsBridge()`)
- Modify: `clients/desktop/src/renderer-shell/desktop-runner-host.ts` (type `remoteHosts` on `DesktopPreloadBridge`)
- Test: `clients/desktop/src/electron-main/ipc/__tests__/remote-hosts-ipc.test.ts`

**Interfaces:**
- Consumes: `probeRemoteHost`, `enumerateTailnetHosts` (2.3); `RunnerHostInvoke`; `bridge.handleInvoke`.
- Produces: `RunnerHostInvoke.remoteHostsProbe`, `RunnerHostInvoke.remoteHostsEnumerate`; `window.runnerHost.remoteHosts: DesktopRemoteHostsBridge` (Interface Contract). **Note:** do NOT add to `IRunnerHost` — a guard test (`runner-host.test.ts:241-253`) asserts there is no `remoteHosts` surface on it. This stays desktop-only.

- [ ] **Step 1: Add channel keys** to `RunnerHostInvoke` in `ipc-channels.ts`:

```ts
remoteHostsProbe: "runnerHost:remoteHosts:probe",
remoteHostsEnumerate: "runnerHost:remoteHosts:enumerate",
```

- [ ] **Step 2: Write the failing main-handler test.** Mirror existing ipc tests: construct the bridge with a fake `host`/window registry, supply a `senderFrame` with `parent: null` + a registered `sender.id`, invoke the handler, assert it returns the probe result. Inject the probe/enumerate fns into `registerRemoteHostsIpc` (pass them as a `deps` arg so the test supplies fakes).

- [ ] **Step 3: Run; expect failure.**

- [ ] **Step 4: Implement `remote-hosts-ipc.ts`:**

```ts
import type { RunnerIpcBridge } from "./runner-ipc-bridge";
import { RunnerHostInvoke } from "../../ipc-contracts/ipc-channels";
import { enumerateTailnetHosts, probeRemoteHost } from "../host/remote-probe";

function readTailnetName(raw: unknown): string {
  if (raw === null || typeof raw !== "object") {
    throw new Error("remoteHosts.probe requires { tailnetName }");
  }
  const name = (raw as Record<string, unknown>).tailnetName;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("remoteHosts.probe requires a non-empty tailnetName");
  }
  return name;
}

export function registerRemoteHostsIpc(bridge: RunnerIpcBridge): void {
  bridge.handleInvoke(RunnerHostInvoke.remoteHostsProbe, async (_event, raw: unknown) => {
    return probeRemoteHost({ tailnetName: readTailnetName(raw) });
  });
  bridge.handleInvoke(RunnerHostInvoke.remoteHostsEnumerate, async () => {
    return enumerateTailnetHosts();
  });
}
```

- [ ] **Step 5: Call `registerRemoteHostsIpc(this)`** inside `RunnerIpcBridge.install()` (runner-ipc-bridge.ts ~311-332, beside the other `registerXxxIpc(this)` calls). Because `dispose()` iterates `Object.values(RunnerHostInvoke)`, the new channels are torn down automatically (no extra cleanup wiring).

- [ ] **Step 6: Implement the preload builder** `remote-hosts-bridge.ts`:

```ts
import { ipcRenderer } from "electron";
import { RunnerHostInvoke } from "../ipc-contracts/ipc-channels";
import type {
  DiscoveredRemoteHost,
  RemoteHostProbe,
} from "../ipc-contracts/remote-host-types";
import type { DesktopRemoteHostsBridge } from "../renderer-shell/desktop-runner-host";

export function buildRemoteHostsBridge(): DesktopRemoteHostsBridge {
  return {
    probe: (input) =>
      ipcRenderer.invoke(RunnerHostInvoke.remoteHostsProbe, input) as Promise<RemoteHostProbe>,
    enumerate: () =>
      ipcRenderer.invoke(RunnerHostInvoke.remoteHostsEnumerate) as Promise<
        readonly DiscoveredRemoteHost[]
      >,
  };
}
```

- [ ] **Step 7: Compose it** into `preload-bridge.ts`'s `contextBridge.exposeInMainWorld("runnerHost", { ... remoteHosts: buildRemoteHostsBridge() })`.

- [ ] **Step 8: Type the surface** on `DesktopPreloadBridge` in `desktop-runner-host.ts` (add `readonly remoteHosts: DesktopRemoteHostsBridge;`) and export the `DesktopRemoteHostsBridge` interface there (Interface Contract shape). Import its field types via `import type { RemoteHostProbe, DiscoveredRemoteHost } from "../ipc-contracts/remote-host-types";` (desktop cannot import `@traycer-clients/shared`). Do **not** add it to `IRunnerHost` or re-wrap in `DesktopRunnerHost`.

- [ ] **Step 9: Type-check + test.** Run `bunx nx run @traycer-clients/desktop:compile` and the ipc test. Expect PASS.

- [ ] **Step 10: Commit.**

```bash
git add clients/desktop/src/ipc-contracts/ipc-channels.ts clients/desktop/src/electron-main/ipc/remote-hosts-ipc.ts clients/desktop/src/electron-main/ipc/runner-ipc-bridge.ts clients/desktop/src/electron-preload/remote-hosts-bridge.ts clients/desktop/src/electron-preload/preload-bridge.ts clients/desktop/src/renderer-shell/desktop-runner-host.ts clients/desktop/src/electron-main/ipc/__tests__/remote-hosts-ipc.test.ts
git commit -m "feat(desktop): remote-hosts IPC bridge (probe + enumerate)"
```

### Task 2.5: The real `RemoteHostFetcher` + desktop mount wiring

**Files:**
- Create: `clients/gui-app/src/lib/host/tailnet-remote-fetcher.ts`
- Modify: `clients/gui-app/index.ts` (re-export `createTailnetRemoteFetcher` + `useRemoteHostsStore` for the desktop barrel)
- Modify: `clients/desktop/src/renderer-shell/main.tsx` (pass the real fetcher instead of `null`)
- Test: `clients/gui-app/src/lib/host/__tests__/tailnet-remote-fetcher.test.ts`

**Interfaces:**
- Consumes: `useRemoteHostsStore` (2.1/2.2), `toRemoteDirectoryEntry`/`normalizeTailnetName` (2.1), `DesktopRemoteHostsBridge` (2.4), `RemoteHostFetcher`/`HostDirectoryEntry` (shared).
- Produces: `function createTailnetRemoteFetcher(deps: { readonly probe: (input: { readonly tailnetName: string }) => Promise<RemoteHostProbe>; readonly enumerate: () => Promise<readonly DiscoveredRemoteHost[]>; readonly readState: () => { readonly manualHosts: ReadonlyArray<ManualRemoteHost>; readonly disabledDiscovered: Readonly<Record<string, boolean>> } }): RemoteHostFetcher`. The returned fetcher: enumerate + read store; merge discovered (minus disabled) with manual; **de-dupe by `hostId`** (manual wins its label); probe each surviving host for `status`; map via `toRemoteDirectoryEntry`. Never throws (boundary): wrap the whole body so any failure returns `[]`.

- [ ] **Step 1: Write the failing test** (inject fakes, no IPC, no React):

```ts
import { describe, expect, it } from "vitest";
import { createTailnetRemoteFetcher } from "@/lib/host/tailnet-remote-fetcher";

describe("createTailnetRemoteFetcher", () => {
  it("merges discovered + manual, de-duped by hostId, with probed status", async () => {
    const fetcher = createTailnetRemoteFetcher({
      enumerate: async () => [{ tailnetName: "studio.ts.net", hostId: "h1", version: "1.0.0" }],
      probe: async () => ({ reachable: true, hostId: "h1", version: "1.0.0" }),
      readState: () => ({
        manualHosts: [{ tailnetName: "nuc.ts.net", label: "NUC", hostId: "h2", addedAt: 1 }],
        disabledDiscovered: {},
      }),
    });
    const entries = await fetcher();
    expect(entries.map((e) => e.hostId).sort()).toEqual(["h1", "h2"]);
    expect(entries.every((e) => e.kind === "remote")).toBe(true);
  });

  it("drops a discovered host the user disabled", async () => {
    const fetcher = createTailnetRemoteFetcher({
      enumerate: async () => [{ tailnetName: "studio.ts.net", hostId: "h1", version: "1.0.0" }],
      probe: async () => ({ reachable: true, hostId: "h1", version: "1.0.0" }),
      readState: () => ({ manualHosts: [], disabledDiscovered: { h1: true } }),
    });
    expect(await fetcher()).toHaveLength(0);
  });

  it("returns [] when enumeration throws", async () => {
    const fetcher = createTailnetRemoteFetcher({
      enumerate: async () => { throw new Error("tailscale missing"); },
      probe: async () => ({ reachable: false, hostId: null, version: null }),
      readState: () => ({ manualHosts: [], disabledDiscovered: {} }),
    });
    expect(await fetcher()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement `createTailnetRemoteFetcher`.** Status mapping: `probe.reachable ? "available" : "unavailable"`. Manual host with no successful probe still appears as `"unavailable"` (don't drop it). Label: manual → its `label`; discovered → the `tailnetName`. Wrap in a single try/catch returning `[]`.

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5a: Re-export from the gui-app barrel.** Desktop resolves gui-app ONLY through the package root (`clients/gui-app/index.ts` → `@traycer-clients/gui-app`); there is no subpath export and no `@/*` alias for the desktop renderer-shell. Add to `clients/gui-app/index.ts`:

```ts
export { createTailnetRemoteFetcher } from "@/lib/host/tailnet-remote-fetcher";
export { useRemoteHostsStore } from "@/stores/remote-hosts/remote-hosts-store";
```

- [ ] **Step 5b: Wire the desktop mount.** In `main.tsx`, build ONE stable fetcher before `render` and pass it. It reads the store at call time so Settings edits take effect without remounting HostRuntime (`remoteFetcher` identity MUST stay stable — build it once, outside `render`). Import from the barrel, exactly like the existing `TraycerApp` import:

```ts
import {
  TraycerApp,
  hostRpcRegistry,
  createTailnetRemoteFetcher,
  useRemoteHostsStore,
} from "@traycer-clients/gui-app";

const remoteFetcher = createTailnetRemoteFetcher({
  probe: (input) => bridge.remoteHosts.probe(input),
  enumerate: () => bridge.remoteHosts.enumerate(),
  readState: () => {
    const s = useRemoteHostsStore.getState();
    return { manualHosts: s.manualHosts, disabledDiscovered: s.disabledDiscovered };
  },
});
// ...
<TraycerApp runnerHost={host} registry={hostRpcRegistry} remoteFetcher={remoteFetcher} initialRoute={bridge.initialRoute} />
```

- [ ] **Step 6: Type-check both workspaces.** `bunx nx run @traycer-clients/gui-app:compile` and `bunx nx run @traycer-clients/desktop:compile`. Expect no errors.

- [ ] **Step 7: Commit.**

```bash
git add clients/gui-app/src/lib/host/tailnet-remote-fetcher.ts clients/gui-app/src/lib/host/__tests__/tailnet-remote-fetcher.test.ts clients/gui-app/index.ts clients/desktop/src/renderer-shell/main.tsx
git commit -m "feat: real tailnet RemoteHostFetcher wired at the desktop mount"
```

### Task 2.6: Settings → Remote Hosts panel

**Files:**
- Modify: `clients/gui-app/src/lib/settings-sections.ts` (union member + array entry + icon import)
- Modify: `clients/gui-app/src/stores/tabs/kinds/settings.tsx` (`settingsRouteOptions` case)
- Modify: `clients/gui-app/src/components/settings/settings-modal-content.tsx` (`SettingsPanelForSection` case + import)
- Create: `clients/gui-app/src/routes/settings.remote-hosts.tsx`
- Create: `clients/gui-app/src/components/settings/panels/remote-hosts-settings-panel.tsx`
- Modify: `clients/gui-app/src/components/settings/__tests__/settings-sidebar.test.tsx` (if it asserts the section list)
- Test: `clients/gui-app/src/components/settings/panels/__tests__/remote-hosts-settings-panel.test.tsx`

**Interfaces:**
- Consumes: `useRemoteHostsStore` (2.2), `useHostDirectoryList` (existing), `SettingsPanelShell`, shadcn `Button`/`Input`, lucide `Network`/`Plus`/`Trash2`. Add-host flow probes `/whoami` via `window.runnerHost.remoteHosts.probe` to capture the real `hostId`.
- Produces: `export function RemoteHostsSettingsPanel(): ReactNode`.

- [ ] **Step 1: Register the section (4 files).** Append `"remote-hosts"` to the `SettingsSectionId` union and a `{ id: "remote-hosts", label: "Remote Hosts", icon: Network }` entry near the end of `SETTINGS_SECTIONS` (before `"host"` to minimize leader-digit churn); add the `Network` import from `lucide-react`. Add the `settingsRouteOptions` case (`return { to: "/settings/remote-hosts" } as const;`) and the `SettingsPanelForSection` case + import. Both switches are exhaustive with no default — compile will fail until all are added.

- [ ] **Step 2: Create the route file** `routes/settings.remote-hosts.tsx` (mirror `settings.worktrees.tsx` verbatim; `routeTree.gen.ts` regenerates automatically — do not hand-edit it).

- [ ] **Step 3: Write a failing panel test.** Render the panel (jsdom), seed `useRemoteHostsStore.setState({ manualHosts: [{...}], disabledDiscovered: {} })`, assert the manual host's label renders and the "Add host" control exists. Mirror `providers-settings-panel.test.tsx` render style.

- [ ] **Step 4: Run; expect failure.**

- [ ] **Step 5: Implement the panel** using the skeleton mapped from providers/worktrees panels: `SettingsPanelShell title="Remote Hosts"`, a toolbar row with an "Add host" `Button`, list rows for `useHostDirectoryList()` entries with `kind === "remote"` showing label + address + an online/offline badge from `status`, a per-row enable/disable toggle that calls `setDiscoveredDisabled`, and a `Trash2` remove for manual hosts calling `removeManualHost`. The add flow: an `Input` for the tailnet name → on submit, `normalizeTailnetName`, call `window.runnerHost.remoteHosts.probe({ tailnetName })`; if `reachable && hostId`, `addManualHost({ tailnetName, label: tailnetName, hostId, addedAt: Date.now() })`; else show an inline "couldn't reach this host" message. Use `cn()`, `text-ui-sm`/`text-ui-xs`, no fixed px.

- [ ] **Step 5b: Spec error-handling affordances.** Two items from the spec's "Error handling" section, surfaced in the panel:
  - **hostId changed on re-probe** (host reinstalled): give each *manual* host row a "Re-check" `Button` that calls `probe({ tailnetName })`; if `probe.hostId !== null && probe.hostId !== storedHostId`, render an inline `⚠ Host identity changed` message with an "Update" action that does `removeManualHost(storedHostId)` then `addManualHost({ ...host, hostId: probe.hostId })`. Add a test: stub `window.runnerHost.remoteHosts.probe` to return a different `hostId`, click Re-check, assert the warning renders.
  - **Bearer rejected (wrong account)**: a host can be reachable yet reject the bearer (different account). Render a static guidance line at the bottom of the panel: "Remote hosts require the same Traycer account signed in on both machines. If a host shows online but chats won't load, confirm the accounts match." (The connect-time `HostRpcError` itself already surfaces in the chat UI; this is the panel-side hint the spec calls for.)

- [ ] **Step 6: Run; expect PASS.** Update `settings-sidebar.test.tsx` if it asserts the section list.

- [ ] **Step 7: Type-check.** `bunx nx run @traycer-clients/gui-app:compile`.

- [ ] **Step 8: Commit.**

```bash
git add clients/gui-app/src/lib/settings-sections.ts clients/gui-app/src/stores/tabs/kinds/settings.tsx clients/gui-app/src/components/settings/settings-modal-content.tsx clients/gui-app/src/routes/settings.remote-hosts.tsx clients/gui-app/src/components/settings/panels/remote-hosts-settings-panel.tsx clients/gui-app/src/components/settings/panels/__tests__/remote-hosts-settings-panel.test.tsx clients/gui-app/src/components/settings/__tests__/settings-sidebar.test.tsx
git commit -m "feat(gui-app): Settings -> Remote Hosts panel"
```

### Task 2.7: Refresh triggers — store changes + periodic re-probe

Without this, nothing re-runs the fetcher after the panel mutates the store, and there is no periodic re-probe — so `HostDirectoryService.refresh()` only fires at `start()` and on local-host snapshots (`host-directory-service.ts:88-103`). The picker would never reflect a disable/add/remove or an offline→online flip. This task closes that gap (spec: discovery "on start / periodically"; Acceptance #1, #6).

**Files:**
- Create: `clients/gui-app/src/lib/host/remote-hosts-refresh.ts`
- Modify: `clients/gui-app/src/providers/host-runtime-provider.tsx` (install the refresh wiring in the same effect that builds `HostDirectoryService`, dispose on cleanup)
- Test: `clients/gui-app/src/lib/host/__tests__/remote-hosts-refresh.test.ts`

**Interfaces:**
- Consumes: `useRemoteHostsStore` (Zustand `.subscribe`), the `HostDirectoryService` instance (its `refresh()`).
- Produces: `function installRemoteHostsRefresh(deps: { readonly refresh: () => void; readonly subscribe: (listener: () => void) => () => void; readonly scheduleInterval: (callback: () => void, ms: number) => () => void; readonly intervalMs: number }): () => void` (returns a dispose). Deps are injected so the unit test needs no React and no real timers. `const REMOTE_HOSTS_REFRESH_INTERVAL_MS = 15_000;` lives in this file.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { installRemoteHostsRefresh } from "../remote-hosts-refresh";

describe("installRemoteHostsRefresh", () => {
  it("refreshes on store change and on the interval, and disposes both", () => {
    let storeListener: (() => void) | null = null;
    let intervalCb: (() => void) | null = null;
    let unsubscribed = false;
    let cleared = false;
    let refreshes = 0;

    const dispose = installRemoteHostsRefresh({
      refresh: () => { refreshes += 1; },
      subscribe: (l) => { storeListener = l; return () => { unsubscribed = true; }; },
      scheduleInterval: (cb) => { intervalCb = cb; return () => { cleared = true; }; },
      intervalMs: 15_000,
    });

    storeListener?.();
    intervalCb?.();
    expect(refreshes).toBe(2);

    dispose();
    expect(unsubscribed).toBe(true);
    expect(cleared).toBe(true);
  });
});
```

- [ ] **Step 2: Run; expect failure.** Run: `bunx vitest run --config vitest.config.ts src/lib/host/__tests__/remote-hosts-refresh.test.ts` (from `clients/gui-app/`).

- [ ] **Step 3: Implement `remote-hosts-refresh.ts`.**

```ts
export const REMOTE_HOSTS_REFRESH_INTERVAL_MS = 15_000;

export interface RemoteHostsRefreshDeps {
  readonly refresh: () => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly scheduleInterval: (callback: () => void, ms: number) => () => void;
  readonly intervalMs: number;
}

export function installRemoteHostsRefresh(deps: RemoteHostsRefreshDeps): () => void {
  const unsubscribe = deps.subscribe(() => deps.refresh());
  const clearScheduled = deps.scheduleInterval(() => deps.refresh(), deps.intervalMs);
  return () => {
    unsubscribe();
    clearScheduled();
  };
}
```

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5: Wire it into `host-runtime-provider.tsx`.** In the effect that constructs `new HostDirectoryService({ runnerHost, remoteFetcher })` and calls `directory.start()`, after start install the refresh and push its dispose into the effect cleanup:

```ts
const disposeRemoteRefresh = installRemoteHostsRefresh({
  refresh: () => { void directory.refresh(); },
  subscribe: (listener) => useRemoteHostsStore.subscribe(listener),
  scheduleInterval: (callback, ms) => {
    const id = setInterval(callback, ms);
    return () => clearInterval(id);
  },
  intervalMs: REMOTE_HOSTS_REFRESH_INTERVAL_MS,
});
// ...in the effect's return cleanup:
disposeRemoteRefresh();
```

(Import `installRemoteHostsRefresh`, `REMOTE_HOSTS_REFRESH_INTERVAL_MS` via `@/lib/host/remote-hosts-refresh` and `useRemoteHostsStore` via `@/stores/remote-hosts/remote-hosts-store`.)

- [ ] **Step 6: Type-check.** `bunx nx run @traycer-clients/gui-app:compile`.

- [ ] **Step 7: Commit.**

```bash
git add clients/gui-app/src/lib/host/remote-hosts-refresh.ts clients/gui-app/src/lib/host/__tests__/remote-hosts-refresh.test.ts clients/gui-app/src/providers/host-runtime-provider.tsx
git commit -m "feat(gui-app): refresh host directory on remote-hosts store change + interval"
```

---

## Phase 3 — Integration & acceptance

### Task 3.1: Full-suite gate

- [ ] **Step 1: Compile every touched workspace.** `bunx nx run @traycer-clients/traycer-cli:compile`, `:gui-app:compile`, `:desktop:compile` (shared is checked transitively).
- [ ] **Step 2: Run tests.** `bunx nx run @traycer-clients/traycer-cli:test`, `:gui-app:test`, `:desktop:test`. Expect all green.
- [ ] **Step 3: Lint.** `bun run lint`. Expect zero warnings.

### Task 3.2: Two-machine manual acceptance (shared account)

Prereq: both machines on the tailnet, HTTPS enabled, **same Traycer account** signed in on both, bridge installed on machine B (`traycer tailnet-bridge install`).

- [ ] From machine A, open **Settings → Remote Hosts**: machine B appears (auto-discovered) online with its version, using B's real `hostId`. (Acceptance #1, #6)
- [ ] Add a host manually by tailnet name; it captures the real `hostId` via `/whoami`. (Acceptance #1)
- [ ] B appears in the host picker; selecting it binds with no error. (Acceptance #2)
- [ ] Open a GUI chat on B → an agent runs end-to-end. (Acceptance #3)
- [ ] Open a terminal tab on B → a working PTY. (Acceptance #4)
- [ ] Restart B's host (it gets a new port); after the bridge reconciles, an existing `wss://B/rpc` binding still works. (Acceptance #5)
- [ ] Disable B in Settings → it disappears from the picker. (Acceptance #6)

---

## Self-Review

**1. Spec coverage:**
- Auto-discovery → Task 2.3 (`enumerateTailnetHosts`) + 2.5 (merge). ✓
- Settings panel (discovered + manual + status badges) → Task 2.6. ✓
- `tailscale serve` forwarder + respawn reconcile → Tasks 1.3, 1.4. ✓
- Real `hostId` via `/whoami` → Tasks 1.2, 2.3, 2.6. ✓
- Shared-account model → Phase 3 prereq (no code; it's an operational constraint). ✓
- Service install/uninstall/status (macOS/Linux; win32 refused) → Task 1.5. ✓
- "On start / periodically" refresh + offline→online flips reaching the picker → Task 2.7. ✓
- Error handling: probe-unreachable status → Tasks 2.3/2.5; hostId-changed warning + bearer/auth hint → Task 2.6 Step 5b; serve-failure/pid-absent resilience → Tasks 1.3/1.4. ✓
- Transport unchanged / remote-`wss` safe → confirmed by mapping (no task needed). ✓
- De-risk first → Phase 0. ✓

**2. Placeholder scan:** No `TBD`/`TODO`. Two deliberate deferrals are explicit, not placeholders: (a) Task 0.1 fixes the exact `tailscale serve` argv that Tasks 1.3 uses; (b) Task 1.5 status reports install-state only (port-based liveness deferred). Both are called out with concrete fallbacks.

**3. Type consistency:** `RemoteHostProbe`, `DiscoveredRemoteHost`, `TailnetWhoami`, `ManualRemoteHost`, `DesktopRemoteHostsBridge`, channel names, and `wss://<name>/rpc` are all pinned in the Interface Contract and referenced identically across Tasks 1.2/2.1/2.3/2.4/2.5/2.6. `toRemoteDirectoryEntry` is the single entry-builder (Task 2.1) used by 2.5. The store shape in 2.2 matches the `readState` dep in 2.5.

**4. Known cross-package seams to watch during execution:**
- Desktop main/preload cannot import `@traycer-clients/shared` → remote types are re-declared in `ipc-contracts/remote-host-types.ts` (Task 2.3) and kept identical to the shared `tailnet-remote.ts` shapes by hand.
- Desktop resolves gui-app only through its package barrel (`@traycer-clients/gui-app`), no subpath/`@` alias for renderer-shell → `createTailnetRemoteFetcher` + `useRemoteHostsStore` are re-exported from `clients/gui-app/index.ts` (Task 2.5 Step 5a) before the mount imports them.
- `remoteFetcher` identity must stay stable (Task 2.5) or HostRuntime remounts; dynamism is read from the store at call time, and store/interval changes drive `directory.refresh()` (Task 2.7).
- `IRunnerHost` must NOT gain a `remoteHosts` surface (guard test) → IPC stays desktop-only (Task 2.4).
- Bridge OS-service is macOS/Linux only; win32 is refused with `SERVICE_UNSUPPORTED_PLATFORM` (Task 1.5) because `windowsTaskName`/`serviceManifestPath` don't key on the bridge label.
