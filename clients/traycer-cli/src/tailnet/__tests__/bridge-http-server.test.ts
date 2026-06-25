import { createHash } from "node:crypto";
import { connect, createServer, type Socket } from "node:net";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startBridgeHttpServer } from "../bridge-http-server";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// A stand-in for the real host's WS server: it accepts the upgrade ONLY when the
// request `Host` is its own loopback authority and 403s anything else - the same
// DNS-rebinding / CSWSH guard that makes the un-rewritten tailnet Host fail.
// Records the Host it saw so the test can assert the bridge rewrote it.
async function startFakeHost(): Promise<{
  port: number;
  seenHost: () => string | undefined;
  close: () => Promise<void>;
}> {
  let seen: string | undefined;
  const sockets = new Set<Socket>();
  const headerValue = (headerLines: string[], name: string): string => {
    const line = headerLines.find((l) =>
      l.toLowerCase().startsWith(`${name}:`),
    );
    return line === undefined ? "" : line.slice(line.indexOf(":") + 1).trim();
  };
  // Raw-TCP stand-in (like the real bridge) so the test exercises the same
  // runtime-agnostic path rather than node:http's upgrade socket.
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      const headerLines = buffer.subarray(0, end).toString("utf8").split("\r\n").slice(1);
      seen = headerValue(headerLines, "host");
      const expected = `127.0.0.1:${(server.address() as { port: number }).port}`;
      if (seen !== expected) {
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      const key = headerValue(headerLines, "sec-websocket-key");
      const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as { port: number }).port,
    seenHost: () => seen,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

// Open a raw WS upgrade against the bridge with a caller-supplied `Host` header
// (simulating the tailnet Host `tailscale serve` forwards) and resolve the HTTP
// status code from the line the bridge relays back. Hand-rolled over a TCP
// socket so the request Host can be an arbitrary tailnet name (the WHATWG
// WebSocket API forbids setting Host) and so the assertion reads the exact
// status line rather than relying on the http client's upgrade event.
function upgradeThroughBridge(input: {
  bridgePort: number;
  hostHeader: string;
}): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const sock = connect(input.bridgePort, "127.0.0.1", () => {
      sock.write(
        `GET /rpc HTTP/1.1\r\n` +
          `Host: ${input.hostHeader}\r\n` +
          `Connection: Upgrade\r\n` +
          `Upgrade: websocket\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let buffer = "";
    sock.setTimeout(4000, () => {
      sock.destroy();
      reject(new Error("upgrade timed out"));
    });
    sock.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/^HTTP\/1\.1 (\d{3})/);
      if (match !== null) {
        sock.destroy();
        resolve(Number.parseInt(match[1], 10));
      }
    });
    sock.on("error", reject);
  });
}

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

  it("re-originates a /rpc upgrade to the host with a loopback Host rewrite", async () => {
    const fakeHost = await startFakeHost();
    const tempHome = await mkdtemp(join(tmpdir(), "traycer-bridge-ws-"));
    const originalHome = process.env.HOME;
    try {
      await mkdir(join(tempHome, ".traycer", "host"), { recursive: true });
      await writeFile(
        join(tempHome, ".traycer", "host", "pid.json"),
        JSON.stringify({
          pid: 4242,
          hostId: "host-xyz",
          version: "9.9.9",
          websocketUrl: `ws://127.0.0.1:${fakeHost.port}/rpc`,
          startedAt: new Date().toISOString(),
        }),
      );
      process.env.HOME = tempHome;
      vi.resetModules();
      const { startBridgeHttpServer: startFresh } = await import("../bridge-http-server");
      const server = await startFresh({ environment: undefined, host: "127.0.0.1", port: 0 });
      try {
        // The inbound Host is a tailnet name (what tailscale serve forwards); the
        // fake host would 403 it unrewritten. A 101 proves the bridge rewrote it.
        const status = await upgradeThroughBridge({
          bridgePort: server.port,
          hostHeader: "dummy-node.tailnet.ts.net:8443",
        });
        expect(status).toBe(101);
        expect(fakeHost.seenHost()).toBe(`127.0.0.1:${fakeHost.port}`);
      } finally {
        await server.close();
      }
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
      await fakeHost.close();
    }
  });

  it("refuses a /rpc upgrade with 503 when the host is not running", async () => {
    const tempHome = await mkdtemp(join(tmpdir(), "traycer-bridge-nohost-"));
    const originalHome = process.env.HOME;
    try {
      process.env.HOME = tempHome;
      vi.resetModules();
      const { startBridgeHttpServer: startFresh } = await import("../bridge-http-server");
      const server = await startFresh({ environment: undefined, host: "127.0.0.1", port: 0 });
      try {
        const status = await upgradeThroughBridge({
          bridgePort: server.port,
          hostHeader: "dummy-node.tailnet.ts.net:8443",
        });
        expect(status).toBe(503);
      } finally {
        await server.close();
      }
    } finally {
      process.env.HOME = originalHome;
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
