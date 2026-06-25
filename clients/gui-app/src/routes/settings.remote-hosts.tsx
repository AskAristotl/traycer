import { createFileRoute } from "@tanstack/react-router";
import { RemoteHostsSettingsPanel } from "@/components/settings/panels/remote-hosts-settings-panel";

export const Route = createFileRoute("/settings/remote-hosts")({
  component: RemoteHostsSettingsPanel,
});
