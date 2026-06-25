// The deployment slot the CLI + host operate on IS the build's
// `config.environment` (dev | production), baked per build - there is no
// separate "channel" concept, flag, or env. Each environment is an isolated
// install tree + service label, so a production build only ever touches the
// production tree, dev the dev tree:
//   - "production" → ~/.traycer/<component>/         + ai.traycer.host
//   - "dev"        → ~/.traycer/<component>/dev/      + ai.traycer.host.dev
//
// `resolveRuntimeContext` sets `RuntimeContext.environment` from
// `config.environment`. Re-exported here so runner-aware modules import the
// type from a single place.
export type { Environment } from "../config";

import type { Environment } from "../config";

// The environment whose backend a stored token authenticates against - i.e.
// which `cli[/<slot>]/credentials` file the credentials live in. This is the
// path the HOST reads for its owner-binding gate ("Host is not provisioned"
// when it's missing), so the writer (this CLI) and the reader (the host) must
// agree on it.
//
// For `production`/`staging` it equals the build slot: each targets its own
// authn service and runs its own matching host, so credentials stay isolated
// under that slot.
//
// `dev` is the exception, because there is no dev backend. `make dev-desktop`
// signs in against PRODUCTION authn and provisions a downloaded PRODUCTION host
// release (see scripts/dev-desktop.js). That host is launched PATH-only via
// `--host-data-dir` (host-start.ts) and resolves its credentials from its own
// baked `config.environment` - "production" - i.e. the shared-root
// `~/.traycer/cli/credentials`. A dev-slot token is therefore a production
// token and MUST be written to the production scope, or the host's owner gate
// never sees it. Mapping `dev` → `production` here is what keeps the dev CLI
// writer and the prod host reader on the same file.
export function credentialEnvironment(environment: Environment): Environment {
  return environment === "dev" ? "production" : environment;
}
