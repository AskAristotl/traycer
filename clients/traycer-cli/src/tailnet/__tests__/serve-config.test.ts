import { describe, expect, it } from "vitest";
import { applyServeConfig, buildServeArgs } from "../serve-config";

describe("serve-config", () => {
  it("routes every path - including /rpc + /stream - at the bridge (Design B)", () => {
    const args = buildServeArgs({ httpsPort: 8443, bridgePort: 41999 });
    const flat = args.map((a) => a.join(" "));
    expect(flat.some((a) => a.includes("/whoami") && a.includes("41999"))).toBe(true);
    // /rpc + /stream now target the bridge port, not the host ws port, so the
    // bridge can rewrite Host/Origin before re-originating to the host.
    expect(flat.some((a) => a.includes("/rpc") && a.includes("41999"))).toBe(true);
    expect(flat.some((a) => a.includes("/stream") && a.includes("41999"))).toBe(true);
  });

  it("invokes the runner once per mount", async () => {
    const calls: string[][] = [];
    await applyServeConfig({
      httpsPort: 8443,
      bridgePort: 41999,
      run: async (a) => {
        calls.push([...a]);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    expect(calls.length).toBe(
      buildServeArgs({ httpsPort: 8443, bridgePort: 41999 }).length,
    );
  });
});
