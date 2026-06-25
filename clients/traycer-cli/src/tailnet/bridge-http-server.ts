import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

async function handle(
  environment: Environment | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = req.url ?? "";
  if (url === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url === "/whoami") {
    const endpoint = await readBridgeHostEndpoint(environment);
    if (endpoint === null) {
      sendJson(res, 503, { error: "host-not-running" });
      return;
    }
    sendJson(res, 200, { hostId: endpoint.hostId, version: endpoint.version });
    return;
  }
  sendJson(res, 404, { error: "not-found" });
}

export function startBridgeHttpServer(
  options: StartBridgeHttpServerOptions,
): Promise<BridgeHttpServer> {
  const server = createServer((req, res) => {
    void handle(options.environment, req, res).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal" });
      }
    });
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
            server.close((err) => (err === undefined || err === null ? res2() : rej2(err)));
          }),
      });
    });
  });
}
