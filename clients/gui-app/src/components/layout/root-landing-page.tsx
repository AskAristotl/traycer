import { AuthLandingPage } from "@/components/auth/auth-landing-page";
import { HomePage } from "@/components/home/home-page";
import { MobileInbox } from "@/components/mobile/mobile-inbox";
import { useIsMobile } from "@/hooks/ui/use-mobile";
import { useAuthStore } from "@/stores/auth/auth-store";

/**
 * Root index route body.
 *
 * Signed-out users land on the auth-first desktop welcome surface. Once
 * authentication succeeds, `/` becomes the normal landing workspace on desktop;
 * on a phone it becomes the attention-first inbox (full reuse of the
 * cross-epic notifications stream). The surrounding `LocalHostGate` still
 * blocks the composer until the desktop's local host is ready.
 */
export function RootLandingPage() {
  const status = useAuthStore((state) => state.status);
  const isMobile = useIsMobile();

  if (status !== "signed-in") {
    return <AuthLandingPage />;
  }

  if (isMobile) {
    return <MobileInbox />;
  }

  return <HomePage />;
}
