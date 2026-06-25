import "../../../../../__tests__/test-browser-apis";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostDirectoryEntry } from "@traycer-clients/shared/host-client/host-directory";
import { useRemoteHostsStore } from "@/stores/remote-hosts/remote-hosts-store";

// ---------------------------------------------------------------------------
// Mock useHostDirectoryList — controlled per test via hostDirectoryData
// ---------------------------------------------------------------------------
const hostDirectoryMocks = vi.hoisted(() => ({
  data: [] as HostDirectoryEntry[],
}));

vi.mock("@/hooks/host/use-host-directory-list-query", () => ({
  useHostDirectoryList: () => ({ data: hostDirectoryMocks.data }),
}));

// ---------------------------------------------------------------------------
// Mock window.runnerHost.remoteHosts.probe
// ---------------------------------------------------------------------------
const probeMock = vi.fn();

// Seed the global before the module under test loads
Object.defineProperty(globalThis, "runnerHost", {
  configurable: true,
  writable: true,
  value: {
    remoteHosts: {
      probe: probeMock,
      enumerate: vi.fn(() => Promise.resolve([])),
    },
  },
});

// ---------------------------------------------------------------------------
// Import the component under test (after mocks are registered)
// ---------------------------------------------------------------------------
import { RemoteHostsSettingsPanel } from "@/components/settings/panels/remote-hosts-settings-panel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function remoteEntry(
  hostId: string,
  label: string,
  status: "available" | "unavailable",
): HostDirectoryEntry {
  return {
    hostId,
    label,
    kind: "remote",
    websocketUrl: `wss://${label}:8443/rpc`,
    version: "1.0.0",
    status,
  };
}

describe("<RemoteHostsSettingsPanel />", () => {
  beforeEach(() => {
    // Reset store to a known state
    useRemoteHostsStore.setState({
      manualHosts: [],
      disabledDiscovered: {},
    });
    hostDirectoryMocks.data = [];
    probeMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the panel title", () => {
    render(<RemoteHostsSettingsPanel />);
    expect(screen.getByText("Remote Hosts")).toBeDefined();
  });

  it("renders the Add host control", () => {
    render(<RemoteHostsSettingsPanel />);
    expect(
      screen.getByRole("button", { name: /add host/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("textbox", { name: /tailscale machine name/i }),
    ).toBeDefined();
  });

  it("shows empty state when there are no remote hosts", () => {
    render(<RemoteHostsSettingsPanel />);
    expect(screen.getByText(/no remote hosts/i)).toBeDefined();
  });

  it("renders a seeded manual host label from the directory list", () => {
    useRemoteHostsStore.setState({
      manualHosts: [
        {
          tailnetName: "studio.tailnet.ts.net",
          label: "Studio",
          hostId: "h-studio",
          addedAt: 1000,
        },
      ],
      disabledDiscovered: {},
    });
    hostDirectoryMocks.data = [remoteEntry("h-studio", "Studio", "available")];

    render(<RemoteHostsSettingsPanel />);
    expect(screen.getByText("Studio")).toBeDefined();
  });

  it("shows online badge for an available host", () => {
    hostDirectoryMocks.data = [remoteEntry("h-online", "Online Host", "available")];
    useRemoteHostsStore.setState({
      manualHosts: [
        {
          tailnetName: "online-host.ts.net",
          label: "Online Host",
          hostId: "h-online",
          addedAt: 1,
        },
      ],
      disabledDiscovered: {},
    });

    render(<RemoteHostsSettingsPanel />);
    const badge = screen.getByLabelText("Online");
    expect(badge).toBeDefined();
  });

  it("shows offline badge for an unavailable host", () => {
    hostDirectoryMocks.data = [remoteEntry("h-offline", "Offline Host", "unavailable")];
    useRemoteHostsStore.setState({
      manualHosts: [
        {
          tailnetName: "offline-host.ts.net",
          label: "Offline Host",
          hostId: "h-offline",
          addedAt: 1,
        },
      ],
      disabledDiscovered: {},
    });

    render(<RemoteHostsSettingsPanel />);
    const badge = screen.getByLabelText("Offline");
    expect(badge).toBeDefined();
  });

  it("adds a host when probe returns reachable + hostId", async () => {
    probeMock.mockResolvedValueOnce({
      reachable: true,
      hostId: "h-new",
      version: "1.0.0",
    });

    render(<RemoteHostsSettingsPanel />);

    const input = screen.getByRole("textbox", {
      name: /tailscale machine name/i,
    });
    fireEvent.change(input, { target: { value: "new-machine.ts.net" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add host/i }));
      await Promise.resolve();
    });

    const state = useRemoteHostsStore.getState();
    expect(state.manualHosts).toHaveLength(1);
    expect(state.manualHosts[0].hostId).toBe("h-new");
    expect(state.manualHosts[0].tailnetName).toBe("new-machine.ts.net");
  });

  it("shows error when probe returns not reachable", async () => {
    probeMock.mockResolvedValueOnce({
      reachable: false,
      hostId: null,
      version: null,
    });

    render(<RemoteHostsSettingsPanel />);

    const input = screen.getByRole("textbox", {
      name: /tailscale machine name/i,
    });
    fireEvent.change(input, { target: { value: "unreachable.ts.net" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add host/i }));
      await Promise.resolve();
    });

    expect(screen.getByText(/couldn't reach this host/i)).toBeDefined();
    expect(useRemoteHostsStore.getState().manualHosts).toHaveLength(0);
  });

  it("renders the Re-check button for manual hosts", () => {
    useRemoteHostsStore.setState({
      manualHosts: [
        {
          tailnetName: "manual.ts.net",
          label: "Manual",
          hostId: "h-manual",
          addedAt: 1,
        },
      ],
      disabledDiscovered: {},
    });
    hostDirectoryMocks.data = [remoteEntry("h-manual", "Manual", "available")];

    render(<RemoteHostsSettingsPanel />);
    expect(screen.getByRole("button", { name: /re-check/i })).toBeDefined();
  });

  it("shows identity-changed warning when Re-check returns a different hostId", async () => {
    useRemoteHostsStore.setState({
      manualHosts: [
        {
          tailnetName: "manual.ts.net",
          label: "Manual",
          hostId: "h-old",
          addedAt: 1,
        },
      ],
      disabledDiscovered: {},
    });
    hostDirectoryMocks.data = [remoteEntry("h-old", "Manual", "available")];

    probeMock.mockResolvedValueOnce({
      reachable: true,
      hostId: "h-new-id",
      version: "1.1.0",
    });

    render(<RemoteHostsSettingsPanel />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /re-check/i }));
      await Promise.resolve();
    });

    expect(screen.getByText(/host identity changed/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /update/i })).toBeDefined();
  });

  it("clicking Update replaces the stored hostId", async () => {
    useRemoteHostsStore.setState({
      manualHosts: [
        {
          tailnetName: "manual.ts.net",
          label: "Manual",
          hostId: "h-old",
          addedAt: 1,
        },
      ],
      disabledDiscovered: {},
    });
    hostDirectoryMocks.data = [remoteEntry("h-old", "Manual", "available")];

    probeMock.mockResolvedValueOnce({
      reachable: true,
      hostId: "h-replaced",
      version: "1.1.0",
    });

    render(<RemoteHostsSettingsPanel />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /re-check/i }));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /update/i }));
      await Promise.resolve();
    });

    const state = useRemoteHostsStore.getState();
    expect(state.manualHosts.some((h) => h.hostId === "h-replaced")).toBe(true);
    expect(state.manualHosts.some((h) => h.hostId === "h-old")).toBe(false);
  });

  it("renders the account-match guidance line", () => {
    render(<RemoteHostsSettingsPanel />);
    expect(
      screen.getByText(/remote hosts require the same traycer account/i),
    ).toBeDefined();
  });
});
