# @traycer-clients/web — PWA spike

The browser/PWA shell: a third `IRunnerHost` (`WebRunnerHost`) plus a Vite entry
that mounts the **full, unmodified gui-app**. This is the throwaway spike that
proves the mobile client end-to-end before the Capacitor wrapper.

## Run it on your phone (over the tailnet)

**1. Build the web bundle** (point discovery at a bootstrap bridge):

```sh
cd clients/web
VITE_BOOTSTRAP_HOSTS=platos-mac-studio.mercat-elver.ts.net npx vite build
```

Optional build-time env (all have sane defaults):
- `VITE_BOOTSTRAP_HOSTS` — comma-separated tailnet bridge names for `/discover`
  auto-discovery. Without it, add hosts manually in Settings → Remote Hosts.
- `VITE_AUTHN_PROXY_BASE` — defaults to `${origin}/authn` (the same-origin proxy
  the gateway serves). Leave default.
- `VITE_AUTH_REDIRECT_URI` — defaults to `${origin}/`.

**2. Serve it from a tailnet machine** (e.g. Plato) — the gateway serves the
bundle and reverse-proxies `/authn/*` same-origin, fronted by `tailscale serve`:

```sh
# from the repo root on the serving machine, after `traycer` CLI is built/installed:
traycer mobile-gateway serve --web-dir "$(pwd)/clients/web/dist" --https-port 443
```

(The host **bridge** keeps running on `:8443`; the gateway uses a different port
and never resets the bridge's serve config.)

**3. Open it on your phone** (Tailscale connected):

```
https://platos-mac-studio.mercat-elver.ts.net/
```

You'll land on sign-in → `MobileHostGate` (host binding). With
`VITE_BOOTSTRAP_HOSTS` set, the tailnet's Traycer hosts auto-populate; otherwise
add one by tailnet name in Settings → Remote Hosts.

## Known spike caveat — interactive sign-in

The auth **fetches** are same-origin (via the gateway's `/authn` proxy), so CORS
is satisfied. But the OAuth **redirect** returns to a `*.ts.net` origin, which
`platform.traycer.ai` must accept as a registered `redirect_uri`. We don't
control that allowlist, so first-time interactive sign-in may be rejected at the
redirect step. The **Capacitor** shell sidesteps this entirely by registering
the desktop's `traycer://` deep-link scheme. To exercise the spike before that,
import a bearer obtained on the desktop (dev affordance) if redirect sign-in is
blocked.

## Tests

```sh
cd clients/web && npx vitest run     # unit tests (jsdom)
npx tsc --noEmit -p clients/web/tsconfig.json
```
