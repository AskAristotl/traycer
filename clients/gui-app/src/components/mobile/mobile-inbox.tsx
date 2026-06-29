import type { ReactNode } from "react";
import { Bell } from "lucide-react";
import { formatNotification } from "@traycer/protocol/notifications/notification-formatter";
import { Button } from "@/components/ui/button";
import {
  useNotificationsActions,
  useNotificationsList,
  useNotificationsUnread,
} from "@/hooks/notifications/use-notifications-stream";
import { cn } from "@/lib/utils";

/**
 * Mobile inbox: a full-screen, attention-first list over the SAME cross-epic
 * notifications stream that powers the desktop notifications bell
 * (`useNotificationsList` / `useNotificationsActions` / `formatNotification`).
 *
 * Deliberately pure reuse - no new data source and no duplicated rendering
 * logic beyond the mobile layout - so it stays in lockstep with the desktop
 * feed. Rendered only on the `useIsMobile` branch.
 */
export function MobileInbox(): ReactNode {
  const entries = useNotificationsList();
  const unread = useNotificationsUnread();
  const { markAsRead, markAllAsRead } = useNotificationsActions();

  return (
    <div data-testid="mobile-inbox" className="flex h-full w-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell className="size-5" />
          <h1 className="text-base font-semibold">Inbox</h1>
          {unread > 0 ? (
            <span
              data-testid="inbox-unread"
              className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground"
            >
              {unread}
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={unread === 0}
          onClick={() => markAllAsRead()}
        >
          Mark all read
        </Button>
      </header>

      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          You&rsquo;re all caught up.
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto overscroll-contain">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                data-testid="inbox-item"
                onClick={() => markAsRead(entry.id)}
                className={cn(
                  "flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left",
                  entry.readAt === null && "bg-accent/40",
                )}
              >
                <span className="text-sm text-foreground">
                  {formatNotification(entry.event, undefined)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
