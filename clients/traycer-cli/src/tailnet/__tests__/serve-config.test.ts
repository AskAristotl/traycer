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
    expect(calls.length).toBe(
      buildServeArgs({ httpsPort: 8443, bridgePort: 41999, hostWsPort: 4917 }).length,
    );
  });
});
