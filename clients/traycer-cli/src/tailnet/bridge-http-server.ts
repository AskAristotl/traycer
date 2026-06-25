import { createServer, connect, type Socket } from "node:net";
import type { Environment } from "../runner/environment";
import { readBridgeHostEndpoint } from "./host-endpoint";

export interface BridgeHttpServer {
  readonly port: number;
  close(): Promise<void>;
}

export interface StartBridgeHttpServerOptions {
  readonly environment: Environment | undefined;
  readonly host: string;
  readonly port: number;
}

// The host's WS endpoints the bridge re-originates over loopback. Anything else
// reaching the upgrade path is rejected rather than blindly tunnelled.
const PROXIED_WS_PATHS: ReadonlySet<string> = new Set(["/rpc", "/stream"]);

// Cap on the request head we buffer before `\r\n\r\n`; a client that never
// terminates its headers can't grow our memory unbounded.
const MAX_HEAD_BYTES = 64 * 1024;
const HEAD_TERMINATOR = "\r\n\r\n";

// This bridge is a RAW TCP server, not a `node:http` one. Under Bun (which runs
// the dev `tailnet-bridge` via `bun run`), `http.Server` emits the `upgrade`
// event but the socket it hands back cannot be written to - the 101 never
// reaches the client - so a `node:http`-based WebSocket reverse proxy silently
// hangs. Production runs the CLI under Node, where it works, but the single
// implementation must serve both. Speaking HTTP/1.1 directly over a `net`
// socket (a tiny fixed surface: two JSON GETs + a WS upgrade tunnel) is
// runtime-agnostic and sidesteps the Bun limitation entirely.

function jsonResponse(status: number, statusText: string, body: unknown): string {
  const payload = JSON.stringify(body);
  return (
    `HTTP/1.1 ${status} ${statusText}\r\n` +
    `Content-Type: application/json\r\n` +
    `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
    `Connection: close\r\n\r\n` +
    payload
  );
}

// `Connection: Upgrade` (possibly listed alongside `keep-alive`) + `Upgrade:
// websocket` is the WebSocket handshake. Header names are matched
// case-insensitively per HTTP.
function hasWebSocketUpgrade(headerLines: readonly string[]): boolean {
  const valueOf = (name: string): string => {
    const line = headerLines.find((l) =>
      l.toLowerCase().startsWith(`${name}:`),
    );
    if (line === undefined) return "";
    return line.slice(line.indexOf(":") + 1).trim().toLowerCase();
  };
  return (
    valueOf("connection").includes("upgrade") &&
    valueOf("upgrade") === "websocket"
  );
}

// Rewrite `Host` + `Origin` to the host's loopback authority. `tailscale serve`
// forwards the inbound tailnet `Host` unchanged, and the host's WS server 403s
// any non-loopback `Host`/`Origin` (DNS-rebinding / CSWSH guard) - so without
// this rewrite every remote handshake fails. Every other header (notably
// `Sec-WebSocket-Key`) is forwarded verbatim so the host's `Sec-WebSocket-Accept`
// validates against the client's original key.
function rewriteForLoopback(
  headerLines: readonly string[],
  loopbackAuthority: string,
): string[] {
  return headerLines.map((line) => {
    const colon = line.indexOf(":");
    if (colon === -1) return line;
    const name = line.slice(0, colon);
    const lower = name.toLowerCase();
    if (lower === "host") return `${name}: ${loopbackAuthority}`;
    if (lower === "origin") return `${name}: http://${loopbackAuthority}`;
    return line;
  });
}

async function routeRequest(
  environment: Environment | undefined,
  clientSocket: Socket,
  headText: string,
  rest: Buffer,
  track: (socket: Socket) => void,
): Promise<void> {
  const lines = headText.split("\r\n");
  const [method, rawPath] = (lines[0] ?? "").split(" ");
  const path = (rawPath ?? "").split("?")[0];
  const headerLines = lines.slice(1);

  if (method === "GET" && path === "/healthz") {
    clientSocket.end(jsonResponse(200, "OK", { ok: true }));
    return;
  }
  if (method === "GET" && path === "/whoami") {
    const endpoint = await readBridgeHostEndpoint(environment);
    clientSocket.end(
      endpoint === null
        ? jsonResponse(503, "Service Unavailable", { error: "host-not-running" })
        : jsonResponse(200, "OK", {
            hostId: endpoint.hostId,
            version: endpoint.version,
          }),
    );
    return;
  }
  if (PROXIED_WS_PATHS.has(path) && hasWebSocketUpgrade(headerLines)) {
    const endpoint = await readBridgeHostEndpoint(environment);
    if (endpoint === null) {
      // No host to forward to yet - refuse the upgrade so the client retries.
      clientSocket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    const loopbackAuthority = `127.0.0.1:${endpoint.wsPort}`;
    const upstreamHead =
      `${lines[0]}\r\n` +
      `${rewriteForLoopback(headerLines, loopbackAuthority).join("\r\n")}\r\n\r\n`;

    const upstream = connect(endpoint.wsPort, "127.0.0.1");
    track(upstream);
    const destroyBoth = (): void => {
      upstream.destroy();
      clientSocket.destroy();
    };
    upstream.on("error", destroyBoth);
    upstream.on("close", destroyBoth);
    clientSocket.on("error", destroyBoth);
    clientSocket.on("close", destroyBoth);
    upstream.on("connect", () => {
      upstream.write(upstreamHead);
      if (rest.length > 0) upstream.write(rest);
      // The host's 101 + every frame flows straight back through the pipe; the
      // bridge never parses the handshake, it just relays bytes.
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    return;
  }
  clientSocket.end(jsonResponse(404, "Not Found", { error: "not-found" }));
}

export function startBridgeHttpServer(
  options: StartBridgeHttpServerOptions,
): Promise<BridgeHttpServer> {
  // Track every live socket - inbound client sockets AND outbound host sockets
  // opened for proxied upgrades - so `close()` can force them down. A graceful
  // `server.close()` alone waits for live WebSocket connections to end, which
  // would wedge bridge shutdown on abort.
  const activeSockets = new Set<Socket>();
  const track = (socket: Socket): void => {
    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
  };

  const server = createServer((socket) => {
    track(socket);
    socket.on("error", () => undefined);
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf(HEAD_TERMINATOR);
      if (end === -1) {
        if (buffer.length > MAX_HEAD_BYTES) socket.destroy();
        return;
      }
      socket.removeListener("data", onData);
      const headText = buffer.subarray(0, end).toString("utf8");
      const rest = buffer.subarray(end + HEAD_TERMINATOR.length);
      void routeRequest(options.environment, socket, headText, rest, track).catch(
        () => socket.destroy(),
      );
    };
    socket.on("data", onData);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("bridge server bound to a non-TCP address"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((res2, rej2) => {
            for (const socket of activeSockets) {
              socket.destroy();
            }
            server.close((err) =>
              err === undefined || err === null ? res2() : rej2(err),
            );
          }),
      });
    });
  });
}
