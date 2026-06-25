import { create } from "zustand";
import { persist } from "zustand/middleware";
import { basePersistOptions, persistKey, STORE_KEYS } from "@/lib/persist";

export interface ManualRemoteHost {
  readonly tailnetName: string;
  readonly label: string;
  readonly hostId: string;
  readonly addedAt: number;
}

interface RemoteHostsState {
  readonly manualHosts: ReadonlyArray<ManualRemoteHost>;
  readonly disabledDiscovered: Readonly<Record<string, boolean>>;
  addManualHost: (host: ManualRemoteHost) => void;
  removeManualHost: (hostId: string) => void;
  setDiscoveredDisabled: (hostId: string, disabled: boolean) => void;
}

type PersistedRemoteHostsState = Pick<
  RemoteHostsState,
  "manualHosts" | "disabledDiscovered"
>;

export const useRemoteHostsStore = create<RemoteHostsState>()(
  persist(
    (set) => ({
      manualHosts: [],
      disabledDiscovered: {},
      addManualHost: (host: ManualRemoteHost) => {
        set((state) => {
          const existing = state.manualHosts.find(
            (h) => h.hostId === host.hostId,
          );
          if (
            existing !== undefined &&
            existing.tailnetName === host.tailnetName &&
            existing.label === host.label &&
            existing.addedAt === host.addedAt
          ) {
            return state;
          }
          return {
            manualHosts: [
              ...state.manualHosts.filter((h) => h.hostId !== host.hostId),
              host,
            ],
          };
        });
      },
      removeManualHost: (hostId: string) => {
        set((state) => {
          const existing = state.manualHosts.find((h) => h.hostId === hostId);
          if (existing === undefined) {
            return state;
          }
          return {
            manualHosts: state.manualHosts.filter((h) => h.hostId !== hostId),
          };
        });
      },
      setDiscoveredDisabled: (hostId: string, disabled: boolean) => {
        set((state) => {
          const current = state.disabledDiscovered[hostId] ?? false;
          if (current === disabled) {
            return state;
          }
          return {
            disabledDiscovered: {
              ...state.disabledDiscovered,
              [hostId]: disabled,
            },
          };
        });
      },
    }),
    {
      ...basePersistOptions(persistKey(STORE_KEYS.remoteHosts)),
      partialize: (state): PersistedRemoteHostsState => ({
        manualHosts: state.manualHosts,
        disabledDiscovered: state.disabledDiscovered,
      }),
    },
  ),
);

export function manualHostsOf(
  state: Readonly<RemoteHostsState>,
): ReadonlyArray<ManualRemoteHost> {
  return state.manualHosts;
}

export function isDiscoveredDisabled(
  state: Readonly<RemoteHostsState>,
  hostId: string,
): boolean {
  return state.disabledDiscovered[hostId] ?? false;
}
