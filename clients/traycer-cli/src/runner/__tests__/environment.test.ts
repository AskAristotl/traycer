import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliCredentialsPath } from "@traycer/protocol/config/paths";
import { credentialEnvironment } from "../environment";

// Regression guard for the `make dev-desktop` "Host is not provisioned" bug:
// the dev slot runs against the production backend + a downloaded production
// host, so its credentials must resolve to the production (shared-root) scope
// the host reads - NOT the per-slot `cli/dev/` subdir.
describe("credentialEnvironment", () => {
  it("maps the dev slot to production (dev-desktop targets the prod backend)", () => {
    expect(credentialEnvironment("dev")).toBe("production");
  });

  it("leaves production and staging as their own self-targeting slot", () => {
    expect(credentialEnvironment("production")).toBe("production");
    expect(credentialEnvironment("staging")).toBe("staging");
  });

  it("resolves dev credentials to the shared-root file the prod host reads", () => {
    const sharedRoot = join(homedir(), ".traycer", "cli", "credentials");
    expect(cliCredentialsPath(credentialEnvironment("dev"))).toBe(sharedRoot);
    // ...and NOT the per-slot dev subdir, which the host never looks at.
    expect(cliCredentialsPath("dev")).toBe(
      join(homedir(), ".traycer", "cli", "dev", "credentials"),
    );
  });
});
