import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startBridgeHttpServer } from "../bridge-http-server";

describe("bridge-http-server", () => {
  it("serves /healthz", async () => {
    const server = await startBridgeHttpServer({ environment: undefined, host: "127.0.0.1", port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });

  it("serves /whoami with host running", async () => {
    const tempHome = await mkdtemp(join(tmpdir(), "traycer-bridge-"));
    const originalHome = process.env.HOME;
    try {
      await mkdir(join(tempHome, ".traycer", "host"), { recursive: true });
      await writeFile(
        join(tempHome, ".traycer", "host", "pid.json"),
        JSON.stringify({
          pid: 4242,
          hostId: "host-xyz",
          version: "9.9.9",
          websocketUrl: "ws://127.0.0.1:5000/rpc",
          startedAt: new Date().toISOString(),
        }),
      );
      process.env.HOME = tempHome;
      vi.resetModules();
      const { startBridgeHttpServer: startFresh } = await import("../bridge-http-server");
      const server = await startFresh({ environment: undefined, host: "127.0.0.1", port: 0 });
      try {
        const res = await fetch(`http://127.0.0.1:${server.port}/whoami`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ hostId: "host-xyz", version: "9.9.9" });
      } finally {
        await server.close();
      }
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
