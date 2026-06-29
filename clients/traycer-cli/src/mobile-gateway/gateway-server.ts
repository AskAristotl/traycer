import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { routeGatewayRequest, isUnsafeStaticPath } from "./gateway-router";

export interface MobileGateway {
  readonly port: number;
  close(): Promise<void>;
}

export interface StartMobileGatewayOptions {
  /** Absolute path to the built web assets (`clients/web/dist`). */
  readonly webDir: string;
  /** TCP port to listen on (loopback). `0` picks a free port. */
  readonly port: number;
  /** Upstream auth origin, e.g. `https://authn.traycer.ai`. */
  readonly authnOrigin: string;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Resolve a sanitized relative path under `webDir`, or `null` if it escapes. */
export function resolveWithinRoot(
  webDir: string,
  relativePath: string,
): string | null {
  const resolved = normalize(join(webDir, relativePath));
  const root = normalize(webDir);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    return null;
  }
  return resolved;
}

async function serveStatic(
  webDir: string,
  relativePath: string,
  res: ServerResponse,
): Promise<void> {
  const indexPath = join(webDir, "index.html");

  const tryReadFile = async (
    candidate: string,
  ): Promise<{ body: Buffer; contentType: string } | null> => {
    try {
      const body = await readFile(candidate);
      return { body, contentType: contentTypeFor(candidate) };
    } catch {
      return null;
    }
  };

  let result: { body: Buffer; contentType: string } | null = null;
  if (!isUnsafeStaticPath(relativePath)) {
    const resolved = resolveWithinRoot(webDir, relativePath);
    if (resolved !== null) {
      result = await tryReadFile(resolved);
    }
  }

  // SPA fallback: any unknown path (a client route) serves index.html.
  if (result === null) {
    result = await tryReadFile(indexPath);
  }

  if (result === null) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": result.contentType });
  res.end(result.body);
}

export interface ProxyOptions {
  readonly protocol: string;
  readonly hostname: string;
  readonly port: number | string;
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string | string[]>;
}

/**
 * Build the upstream `node:https` request options for an authn proxy hop:
 * resolve the target URL, rewrite `Host` to the upstream, drop hop-by-hop
 * headers, and set `Content-Length` from the buffered body. Pure so the
 * forwarding contract is unit-testable without a TLS upstream.
 */
export function buildProxyOptions(input: {
  readonly authnOrigin: string;
  readonly upstreamPath: string;
  readonly method: string;
  readonly headers: NodeJS.Dict<string | string[]>;
  readonly bodyLength: number;
}): ProxyOptions {
  const upstream = new URL(input.upstreamPath, input.authnOrigin);
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    if (value === undefined) {
      continue;
    }
    const lower = name.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length"
    ) {
      continue;
    }
    headers[name] = value;
  }
  headers.host = upstream.host;
  if (input.bodyLength > 0) {
    headers["content-length"] = String(input.bodyLength);
  }
  return {
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port === "" ? 443 : upstream.port,
    method: input.method,
    path: `${upstream.pathname}${upstream.search}`,
    headers,
  };
}

function proxyAuthn(
  authnOrigin: string,
  upstreamPath: string,
  req: IncomingMessage,
  res: ServerResponse,
  bodyChunks: readonly Buffer[],
): void {
  const body = Buffer.concat([...bodyChunks]);
  const options = buildProxyOptions({
    authnOrigin,
    upstreamPath,
    method: req.method ?? "GET",
    headers: req.headers,
    bodyLength: body.length,
  });

  const proxyReq = httpsRequest(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Bad gateway");
  });
  if (body.length > 0) {
    proxyReq.write(body);
  }
  proxyReq.end();
}

export function startMobileGateway(
  options: StartMobileGatewayOptions,
): Promise<MobileGateway> {
  const server = createServer((req, res) => {
    const route = routeGatewayRequest(req.url ?? "/");
    if (route.kind === "static") {
      void serveStatic(options.webDir, route.relativePath, res);
      return;
    }
    // Buffer the request body (auth POSTs carry a small JSON payload) before
    // forwarding it upstream.
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () =>
      proxyAuthn(options.authnOrigin, route.upstreamPath, req, res, chunks),
    );
    req.on("error", () => res.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("gateway bound to a non-TCP address"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((res2, rej2) => {
            server.close((err) =>
              err === undefined || err === null ? res2() : rej2(err),
            );
          }),
      });
    });
  });
}
