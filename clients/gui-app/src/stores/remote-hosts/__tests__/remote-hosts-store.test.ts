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
