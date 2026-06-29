import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  startMobileGateway,
  buildProxyOptions,
  resolveWithinRoot,
} from "../gateway-server";

async function withGateway(
  webDir: string,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const gateway = await startMobileGateway({
    webDir,
    port: 0,
    authnOrigin: "https://authn.traycer.ai",
    discover: async () => [],
  });
  try {
    await fn(`http://127.0.0.1:${gateway.port}`);
  } finally {
    await gateway.close();
  }
}

describe("mobile gateway /discover", () => {
  it("serves the injected tailnet enumerator same-origin", async () => {
    const webDir = await mkdtemp(join(tmpdir(), "traycer-gw-disc-"));
    const hosts = [
      { tailnetName: "studio.ts.net", hostId: "h1", version: "1.0.0" },
    ];
    try {
      await writeFile(join(webDir, "index.html"), "<!doctype html>");
      const gateway = await startMobileGateway({
        webDir,
        port: 0,
        authnOrigin: "https://authn.traycer.ai",
        discover: async () => hosts,
      });
      try {
        const res = await fetch(`http://127.0.0.1:${gateway.port}/discover`);
        expect(res.status).toBe(200);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
        expect(await res.json()).toEqual({ hosts });
      } finally {
        await gateway.close();
      }
    } finally {
      await rm(webDir, { recursive: true, force: true });
    }
  });
});

describe("mobile gateway static serving", () => {
  it("serves a built asset and the SPA shell, with index.html fallback for client routes", async () => {
    const webDir = await mkdtemp(join(tmpdir(), "traycer-gw-"));
    try {
      await writeFile(join(webDir, "index.html"), "<!doctype html><title>app</title>");
      await mkdir(join(webDir, "assets"), { recursive: true });
      await writeFile(join(webDir, "assets", "app.js"), "console.log(1)");

      await withGateway(webDir, async (base) => {
        const root = await fetch(`${base}/`);
        expect(root.status).toBe(200);
        expect(root.headers.get("content-type")).toContain("text/html");
        expect(await root.text()).toContain("<title>app</title>");

        const asset = await fetch(`${base}/assets/app.js`);
        expect(asset.status).toBe(200);
        expect(asset.headers.get("content-type")).toContain("text/javascript");
        expect(await asset.text()).toBe("console.log(1)");

        // Unknown client-routed path falls back to the SPA shell.
        const route = await fetch(`${base}/epics/123/tab`);
        expect(route.status).toBe(200);
        expect(await route.text()).toContain("<title>app</title>");
      });
    } finally {
      await rm(webDir, { recursive: true, force: true });
    }
  });
});

describe("resolveWithinRoot", () => {
  it("resolves a normal asset under the root", () => {
    expect(resolveWithinRoot("/srv/web", "assets/app.js")).toBe(
      "/srv/web/assets/app.js",
    );
  });

  it("rejects a path that escapes the root", () => {
    expect(resolveWithinRoot("/srv/web", "../etc/passwd")).toBeNull();
  });
});

describe("buildProxyOptions", () => {
  it("rewrites Host to the upstream and drops hop-by-hop headers", () => {
    const opts = buildProxyOptions({
      authnOrigin: "https://authn.traycer.ai",
      upstreamPath: "/api/v3/user",
      method: "GET",
      headers: {
        host: "plato.ts.net",
        connection: "keep-alive",
        authorization: "Bearer abc",
      },
      bodyLength: 0,
    });
    expect(opts.hostname).toBe("authn.traycer.ai");
    expect(opts.port).toBe(443);
    expect(opts.path).toBe("/api/v3/user");
    expect(opts.headers.host).toBe("authn.traycer.ai");
    expect(opts.headers.authorization).toBe("Bearer abc");
    expect(opts.headers.connection).toBeUndefined();
  });

  it("sets Content-Length from the buffered body for a POST", () => {
    const opts = buildProxyOptions({
      authnOrigin: "https://authn.traycer.ai",
      upstreamPath: "/api/v3/auth/exchange-code",
      method: "POST",
      headers: { "content-type": "application/json" },
      bodyLength: 42,
    });
    expect(opts.method).toBe("POST");
    expect(opts.headers["content-length"]).toBe("42");
  });
});
