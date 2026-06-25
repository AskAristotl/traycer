import { describe, expect, it } from "vitest";
import { installRemoteHostsRefresh } from "../remote-hosts-refresh";

describe("installRemoteHostsRefresh", () => {
  it("refreshes on store change and on the interval, and disposes both", () => {
    const captured: { storeListener: (() => void) | null; intervalCb: (() => void) | null } = {
      storeListener: null,
      intervalCb: null,
    };
    let unsubscribed = false;
    let cleared = false;
    let refreshes = 0;

    const dispose = installRemoteHostsRefresh({
      refresh: () => { refreshes += 1; },
      subscribe: (l) => { captured.storeListener = l; return () => { unsubscribed = true; }; },
      scheduleInterval: (cb) => { captured.intervalCb = cb; return () => { cleared = true; }; },
      intervalMs: 15_000,
    });

    captured.storeListener?.();
    captured.intervalCb?.();
    expect(refreshes).toBe(2);

    dispose();
    expect(unsubscribed).toBe(true);
    expect(cleared).toBe(true);
  });
});
