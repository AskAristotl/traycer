import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function seedTempHome(tempHome: string, wsPort: number): Promise<void> {
  await mkdir(join(tempHome, ".traycer", "host"), { recursive: true });
  await writeFile(
    join(tempHome, ".traycer", "host", "pid.json"),
    JSON.stringify({
      pid: 1234,
      hostId: "host-test",
      version: "1.0.0",
      websocketUrl: `ws://127.0.0.1:${wsPort}/rpc`,
      startedAt: new Date().toISOString(),
    }),
  );
}

describe("bridge-runtime", () => {
  it("applies serve config on start and resets on abort", async () => {
    const tempHome = await mkdtemp(join(tmpdir(), "traycer-bridge-runtime-"));
    const originalHome = process.env.HOME;
    try {
      await seedTempHome(tempHome, 4_917);
      process.env.HOME = tempHome;

      // Must resetModules + dynamic import so paths.ts re-evaluates homedir()
      const { vi } = await import("vitest");
      vi.resetModules();
      const { runTailnetBridge } = await import("../bridge-runtime");

      const calls: string[][] = [];
      const ac = new AbortController();
      const run = async (a: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        calls.push([...a]);
        return { stdout: "", stderr: "", exitCode: 0 };
      };
      const done = runTailnetBridge({
        httpsPort: 8_443,
        environment: undefined,
        pollIntervalMs: 10,
        run,
        signal: ac.signal,
      });
      await new Promise<void>((r) => setTimeout(r, 50));
      ac.abort();
      await done;
      expect(calls.some((c) => c.join(" ").includes("/rpc"))).toBe(true);
      expect(calls.some((c) => c.join(" ").includes("--https=8443"))).toBe(true);
      expect(calls.some((c) => c.join(" ").includes("reset"))).toBe(true);
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
