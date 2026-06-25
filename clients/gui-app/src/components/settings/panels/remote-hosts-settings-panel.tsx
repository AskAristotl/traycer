import { useState, type ReactNode } from "react";
import { Network, Plus, Trash2 } from "lucide-react";
import type { RemoteHostProbe } from "@traycer-clients/shared/host-client/tailnet-remote";
import { normalizeTailnetName } from "@traycer-clients/shared/host-client/tailnet-remote";
import type { HostDirectoryEntry } from "@traycer-clients/shared/host-client/host-directory";
import { SettingsPanelShell } from "@/components/settings/settings-panel-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MutedAgentSpinner } from "@/components/ui/agent-spinning-dots";
import { useHostDirectoryList } from "@/hooks/host/use-host-directory-list-query";
import {
  useRemoteHostsStore,
  type ManualRemoteHost,
} from "@/stores/remote-hosts/remote-hosts-store";
import { cn } from "@/lib/utils";

/**
 * Feature-detected access to the desktop-only `remoteHosts` probe surface
 * the Electron preload installs on `window.runnerHost`. gui-app must stay
 * browser-safe, so this reads the global defensively and degrades to null
 * on shells that don't expose it.
 */
interface RemoteHostsBridgeShape {
  readonly probe: (input: {
    readonly tailnetName: string;
  }) => Promise<RemoteHostProbe>;
}

interface RunnerHostRemoteShape {
  readonly remoteHosts?: RemoteHostsBridgeShape;
}

function readRemoteHostsBridge(): RemoteHostsBridgeShape | null {
  const host = (globalThis as { runnerHost?: RunnerHostRemoteShape })
    .runnerHost;
  const remoteHosts = host?.remoteHosts;
  if (remoteHosts !== undefined && typeof remoteHosts.probe === "function") {
    return remoteHosts;
  }
  return null;
}

async function probeRemoteHost(tailnetName: string): Promise<RemoteHostProbe> {
  const bridge = readRemoteHostsBridge();
  if (bridge === null) {
    return { reachable: false, hostId: null, version: null };
  }
  return bridge.probe({ tailnetName });
}

// HostIdentityWarning tracks per-manual-host re-check state
interface HostIdentityWarning {
  readonly tailnetName: string;
  readonly newHostId: string;
}

export function RemoteHostsSettingsPanel(): ReactNode {
  const hostsQuery = useHostDirectoryList();
  const allHosts = hostsQuery.data ?? [];
  const remoteHosts = allHosts.filter(
    (entry): entry is HostDirectoryEntry => entry.kind === "remote",
  );

  const manualHosts = useRemoteHostsStore((s) => s.manualHosts);
  const disabledDiscovered = useRemoteHostsStore((s) => s.disabledDiscovered);
  const addManualHost = useRemoteHostsStore((s) => s.addManualHost);
  const removeManualHost = useRemoteHostsStore((s) => s.removeManualHost);
  const setDiscoveredDisabled = useRemoteHostsStore(
    (s) => s.setDiscoveredDisabled,
  );

  const [addDraft, setAddDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [recheckPending, setRecheckPending] = useState<string | null>(null);
  const [identityWarnings, setIdentityWarnings] = useState<
    ReadonlyArray<HostIdentityWarning>
  >([]);

  const onAdd = async (): Promise<void> => {
    const raw = addDraft.trim();
    if (raw.length === 0 || adding) return;
    const tailnetName = normalizeTailnetName(raw);
    setAdding(true);
    setAddError(null);
    try {
      const result = await probeRemoteHost(tailnetName);
      if (result.reachable && result.hostId !== null) {
        addManualHost({
          tailnetName,
          label: tailnetName,
          hostId: result.hostId,
          addedAt: Date.now(),
        });
        setAddDraft("");
      } else {
        setAddError("Couldn't reach this host. Check the Tailscale name and try again.");
      }
    } catch {
      setAddError("Couldn't reach this host. Check the Tailscale name and try again.");
    } finally {
      setAdding(false);
    }
  };

  const onRecheck = async (host: ManualRemoteHost): Promise<void> => {
    if (recheckPending !== null) return;
    setRecheckPending(host.tailnetName);
    try {
      const result = await probeRemoteHost(host.tailnetName);
      const newId = result.hostId;
      if (newId !== null && newId !== host.hostId) {
        setIdentityWarnings((prev) => [
          ...prev.filter((w) => w.tailnetName !== host.tailnetName),
          { tailnetName: host.tailnetName, newHostId: newId },
        ]);
      } else {
        setIdentityWarnings((prev) =>
          prev.filter((w) => w.tailnetName !== host.tailnetName),
        );
      }
    } catch {
      setIdentityWarnings((prev) =>
        prev.filter((w) => w.tailnetName !== host.tailnetName),
      );
    } finally {
      setRecheckPending(null);
    }
  };

  const onUpdateIdentity = (
    host: ManualRemoteHost,
    newHostId: string,
  ): void => {
    removeManualHost(host.hostId);
    addManualHost({ ...host, hostId: newHostId });
    setIdentityWarnings((prev) =>
      prev.filter((w) => w.tailnetName !== host.tailnetName),
    );
  };

  return (
    <SettingsPanelShell
      title="Remote Hosts"
      description="Connect to Traycer running on other machines via Tailscale. Add a host by its Tailscale MagicDNS name."
    >
      <div className="flex flex-col">
        {/* Toolbar / Add-host row */}
        <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-5 py-3">
          <Network className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-ui-sm text-muted-foreground">
            Add a remote host
          </span>
        </div>

        {/* Add-host form */}
        <div className="border-b border-border/40 px-5 py-4">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Tailscale machine name"
              placeholder="machine.tailnet-name.ts.net"
              value={addDraft}
              onChange={(e) => {
                setAddDraft(e.target.value);
                setAddError(null);
              }}
              disabled={adding}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onAdd();
              }}
              className="text-ui-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onAdd()}
              disabled={adding || addDraft.trim().length === 0}
            >
              {adding ? <MutedAgentSpinner /> : <Plus className="size-4" />}
              Add host
            </Button>
          </div>
          {addError !== null ? (
            <p className="mt-2 text-ui-xs text-destructive">{addError}</p>
          ) : null}
        </div>

        {/* Host rows */}
        {remoteHosts.length === 0 ? (
          <div className="px-5 py-8 text-center text-ui-sm text-muted-foreground">
            No remote hosts. Add a Tailscale machine name above.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border/30">
            {remoteHosts.map((entry) => {
              const manual = manualHosts.find((m) => m.hostId === entry.hostId);
              const isDiscovered = manual === undefined;
              const isDisabled = disabledDiscovered[entry.hostId] ?? false;
              const warning = identityWarnings.find(
                (w) => manual !== undefined && w.tailnetName === manual.tailnetName,
              );
              const isRechecking =
                manual !== undefined &&
                recheckPending === manual.tailnetName;

              return (
                <RemoteHostRow
                  key={entry.hostId}
                  entry={entry}
                  isManual={!isDiscovered}
                  isDisabled={isDisabled}
                  identityWarning={warning ?? null}
                  isRechecking={isRechecking}
                  onToggleDisabled={(disabled) =>
                    setDiscoveredDisabled(entry.hostId, disabled)
                  }
                  onRemove={
                    manual !== undefined
                      ? () => removeManualHost(entry.hostId)
                      : null
                  }
                  onRecheck={
                    manual !== undefined ? () => void onRecheck(manual) : null
                  }
                  onUpdateIdentity={
                    manual !== undefined && warning !== undefined
                      ? () => onUpdateIdentity(manual, warning.newHostId)
                      : null
                  }
                />
              );
            })}
          </div>
        )}

        {/* Account guidance */}
        <div className="border-t border-border/40 px-5 py-4">
          <p className="text-ui-xs text-muted-foreground">
            Remote hosts require the same Traycer account signed in on both
            machines. If a host shows online but chats won&apos;t load, confirm
            the accounts match.
          </p>
        </div>
      </div>
    </SettingsPanelShell>
  );
}

function RemoteHostRow(props: {
  readonly entry: HostDirectoryEntry;
  readonly isManual: boolean;
  readonly isDisabled: boolean;
  readonly identityWarning: HostIdentityWarning | null;
  readonly isRechecking: boolean;
  readonly onToggleDisabled: (disabled: boolean) => void;
  readonly onRemove: (() => void) | null;
  readonly onRecheck: (() => void) | null;
  readonly onUpdateIdentity: (() => void) | null;
}): ReactNode {
  const {
    entry,
    isManual,
    isDisabled,
    identityWarning,
    isRechecking,
    onToggleDisabled,
    onRemove,
    onRecheck,
    onUpdateIdentity,
  } = props;

  const online = entry.status === "available";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-5 py-3",
        isDisabled && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        {/* Status badge */}
        <span
          aria-label={online ? "Online" : "Offline"}
          className={cn(
            "size-2 shrink-0 rounded-full",
            online ? "bg-green-500" : "bg-muted-foreground/40",
          )}
        />

        {/* Label + address */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui-sm font-medium text-foreground">
            {entry.label.length > 0 ? entry.label : entry.hostId}
          </div>
          <div className="flex items-center gap-2">
            <span className="truncate text-ui-xs text-muted-foreground">
              {entry.hostId}
            </span>
            {entry.version !== null ? (
              <span className="shrink-0 text-ui-xs text-muted-foreground">
                v{entry.version}
              </span>
            ) : null}
          </div>
        </div>

        {/* Re-check button (manual hosts only) */}
        {onRecheck !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRecheck}
            disabled={isRechecking}
            className="shrink-0 text-ui-xs text-muted-foreground hover:text-foreground"
          >
            {isRechecking ? <MutedAgentSpinner /> : null}
            Re-check
          </Button>
        ) : null}

        {/* Enable/disable toggle */}
        <Switch
          aria-label={isDisabled ? "Enable host" : "Disable host"}
          checked={!isDisabled}
          onCheckedChange={(checked) => onToggleDisabled(!checked)}
        />

        {/* Remove (manual hosts only) */}
        {onRemove !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${entry.label.length > 0 ? entry.label : entry.hostId}`}
            onClick={onRemove}
            className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>

      {/* Identity-changed warning */}
      {identityWarning !== null ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-ui-xs">
          <span className="flex-1 text-amber-700 dark:text-amber-400">
            ⚠ Host identity changed. The host may have been reinstalled.
          </span>
          {onUpdateIdentity !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onUpdateIdentity}
              className="shrink-0 text-ui-xs"
            >
              Update
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Discovered / manual badge */}
      {!isManual ? (
        <span className="text-ui-xs text-muted-foreground/70">
          Discovered on tailnet
        </span>
      ) : null}
    </div>
  );
}
