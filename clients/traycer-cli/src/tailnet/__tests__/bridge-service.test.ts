import { describe, expect, it, vi, afterEach } from "vitest";
import { bridgeServiceLabelFor } from "../bridge-service";

describe("bridgeServiceLabelFor", () => {
  it("uses bare id and no suffix for production", () => {
    const label = bridgeServiceLabelFor("production");

    expect(label.id).toBe("ai.traycer.tailnet-bridge");
    expect(label.displayName).toBe("Traycer Tailnet Bridge");
    expect(label.environment).toBe("production");
  });

  it("appends environment to id for non-production environments", () => {
    const label = bridgeServiceLabelFor("staging");

    expect(label.id).toBe("ai.traycer.tailnet-bridge.staging");
    expect(label.displayName).toBe("Traycer Tailnet Bridge (Staging)");
    expect(label.environment).toBe("staging");
  });

  it("handles dev environment", () => {
    const label = bridgeServiceLabelFor("dev");

    expect(label.id).toBe("ai.traycer.tailnet-bridge.dev");
    expect(label.displayName).toBe("Traycer Tailnet Bridge (Dev)");
    expect(label.environment).toBe("dev");
  });
});

describe("bridgeServiceInstallCommand win32 guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws SERVICE_UNSUPPORTED_PLATFORM on win32", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    const { buildBridgeServiceInstallCommand } = await import("../bridge-service");
    const command = buildBridgeServiceInstallCommand({ enableLinger: false, allowSelfInvocation: false });

    await expect(
      command({
        runtime: { environment: "production" } as never,
        output: {} as never,
        progress: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "E_SERVICE_UNSUPPORTED_PLATFORM" });
  });
});
