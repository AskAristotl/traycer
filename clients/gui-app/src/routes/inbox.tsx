import { createFileRoute } from "@tanstack/react-router";
import { requireSignedIn } from "@/lib/router-auth";
import { MobileInbox } from "@/components/mobile/mobile-inbox";

/**
 * Mobile inbox route — the attention-first home for the phone client, rendered
 * over the existing cross-epic notifications stream (full reuse). Reachable on
 * any shell, but it is the surface the `useIsMobile` navigation points at.
 */
export const Route = createFileRoute("/inbox")({
  beforeLoad: ({ context }) => {
    requireSignedIn(context);
  },
  component: MobileInbox,
});
