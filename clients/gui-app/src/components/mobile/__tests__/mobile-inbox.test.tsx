import "../../../../__tests__/test-browser-apis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { NotificationEntry } from "@traycer/protocol/notifications/notification-entry";

const markAsRead = vi.fn();
const markAllAsRead = vi.fn();
const state: { entries: ReadonlyArray<NotificationEntry>; unread: number } = {
  entries: [],
  unread: 0,
};

vi.mock("@/hooks/notifications/use-notifications-stream", () => ({
  useNotificationsList: () => state.entries,
  useNotificationsUnread: () => state.unread,
  useNotificationsActions: () => ({
    markAsRead,
    markAllAsRead,
    clearAll: vi.fn(),
  }),
}));

const { MobileInbox } = await import("../mobile-inbox");

function invited(id: string, readAt: number | null): NotificationEntry {
  return {
    id,
    createdAt: 0,
    readAt,
    event: { kind: "invited", epicId: "e1", actorName: "Alice" },
  };
}

afterEach(() => {
  cleanup();
  markAsRead.mockClear();
  markAllAsRead.mockClear();
  state.entries = [];
  state.unread = 0;
});

describe("MobileInbox", () => {
  it("shows an empty state when there are no notifications", () => {
    const { getByText, queryAllByTestId } = render(<MobileInbox />);
    expect(getByText(/all caught up/i)).toBeTruthy();
    expect(queryAllByTestId("inbox-item")).toHaveLength(0);
  });

  it("renders the reused notifications stream, formatted, with an unread badge", () => {
    state.entries = [invited("n1", null), invited("n2", 123)];
    state.unread = 1;
    const { getAllByTestId, getByTestId } = render(<MobileInbox />);
    expect(getAllByTestId("inbox-item")).toHaveLength(2);
    expect(getByTestId("inbox-unread").textContent).toBe("1");
    expect(getAllByTestId("inbox-item")[0].textContent).toContain(
      "Alice invited you to an epic",
    );
  });

  it("marks an item read on tap", () => {
    state.entries = [invited("n1", null)];
    state.unread = 1;
    const { getAllByTestId } = render(<MobileInbox />);
    fireEvent.click(getAllByTestId("inbox-item")[0]);
    expect(markAsRead).toHaveBeenCalledWith("n1");
  });

  it("marks all read from the header action", () => {
    state.entries = [invited("n1", null)];
    state.unread = 1;
    const { getByText } = render(<MobileInbox />);
    fireEvent.click(getByText("Mark all read"));
    expect(markAllAsRead).toHaveBeenCalledTimes(1);
  });
});
