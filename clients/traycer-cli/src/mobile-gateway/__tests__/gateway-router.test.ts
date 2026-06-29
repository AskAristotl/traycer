import { describe, expect, it } from "vitest";
import {
  routeGatewayRequest,
  isUnsafeStaticPath,
} from "../gateway-router";

describe("routeGatewayRequest", () => {
  it("maps the root to the SPA shell", () => {
    expect(routeGatewayRequest("/")).toEqual({
      kind: "static",
      relativePath: "index.html",
    });
  });

  it("proxies /authn/* to the upstream path, stripping the prefix", () => {
    expect(routeGatewayRequest("/authn/api/v3/user")).toEqual({
      kind: "authn",
      upstreamPath: "/api/v3/user",
    });
  });

  it("proxies a bare /authn to the upstream root", () => {
    expect(routeGatewayRequest("/authn")).toEqual({
      kind: "authn",
      upstreamPath: "/",
    });
  });

  it("strips query strings from the upstream path", () => {
    expect(routeGatewayRequest("/authn/api/v3/auth/refresh?x=1")).toEqual({
      kind: "authn",
      upstreamPath: "/api/v3/auth/refresh",
    });
  });

  it("maps a static asset path to a relative path", () => {
    expect(routeGatewayRequest("/assets/index-abc.js")).toEqual({
      kind: "static",
      relativePath: "assets/index-abc.js",
    });
  });

  it("maps a client-routed path to a relative path (server falls back to index.html)", () => {
    expect(routeGatewayRequest("/epics/123/tab")).toEqual({
      kind: "static",
      relativePath: "epics/123/tab",
    });
  });

  it("does not treat /authnx as the authn proxy", () => {
    expect(routeGatewayRequest("/authnx/foo")).toEqual({
      kind: "static",
      relativePath: "authnx/foo",
    });
  });
});

describe("isUnsafeStaticPath", () => {
  it("flags parent-directory traversal", () => {
    expect(isUnsafeStaticPath("/../etc/passwd")).toBe(true);
    expect(isUnsafeStaticPath("assets/../../secret")).toBe(true);
  });

  it("flags NUL bytes", () => {
    expect(isUnsafeStaticPath("/a\0b")).toBe(true);
  });

  it("allows normal asset paths", () => {
    expect(isUnsafeStaticPath("assets/index-abc.js")).toBe(false);
    expect(isUnsafeStaticPath("index.html")).toBe(false);
  });
});
