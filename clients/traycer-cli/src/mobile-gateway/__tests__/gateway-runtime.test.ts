import { describe, expect, it } from "vitest";
import {
  buildGatewayServeArgs,
  buildGatewayServeOffArgs,
} from "../gateway-runtime";

describe("buildGatewayServeArgs", () => {
  it("mounts the loopback gateway at the tailnet root, additively", () => {
    const args = buildGatewayServeArgs({ httpsPort: 443, gatewayPort: 51234 });
    expect(args).toEqual([
      "serve",
      "--bg",
      "--https=443",
      "http://127.0.0.1:51234",
    ]);
  });
});

describe("buildGatewayServeOffArgs", () => {
  it("removes only this port's mount (never a global reset)", () => {
    expect(buildGatewayServeOffArgs({ httpsPort: 443 })).toEqual([
      "serve",
      "--https=443",
      "off",
    ]);
  });
});
