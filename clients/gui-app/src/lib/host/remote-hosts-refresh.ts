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
