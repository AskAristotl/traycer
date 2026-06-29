import "../../../../__tests__/test-browser-apis";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ChatMessage as ChatMessageModel } from "@/stores/composer/chat-store";

interface VirtuosoMockProps {
  readonly data: ReadonlyArray<{ readonly id: string }>;
  readonly context: unknown;
  readonly itemContent: (
    index: number,
    item: { readonly id: string },
    context: unknown,
  ) => ReactNode;
  readonly components?: { readonly Header?: () => ReactNode };
}

vi.mock("react-virtuoso", () => ({
  // Render every item synchronously - jsdom has no layout, so the real
  // virtualizer would mount zero rows.
  Virtuoso: (props: VirtuosoMockProps): ReactNode => (
    <div data-testid="virtuoso">
      {props.components?.Header ? <props.components.Header /> : null}
      {props.data.map((item, index) => (
        <div key={item.id}>{props.itemContent(index, item, props.context)}</div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/chat/chat-message", () => ({
  ChatMessage: (props: {
    readonly message: { readonly id: string };
  }): ReactNode => <div data-testid="chat-message">{props.message.id}</div>,
}));

vi.mock("@/components/chat/chat-empty-state", () => ({
  ChatEmptyState: (): ReactNode => <div data-testid="chat-empty" />,
}));

const { MobileChatMessages } = await import("../mobile-chat-messages");

function fakeMessages(ids: readonly string[]): ReadonlyArray<ChatMessageModel> {
  const rows: ReadonlyArray<Pick<ChatMessageModel, "id" | "role">> = ids.map(
    (id) => ({ id, role: "user" }),
  );
  return rows as ReadonlyArray<ChatMessageModel>;
}

afterEach(() => cleanup());

describe("MobileChatMessages", () => {
  it("renders the empty state when there are no messages", () => {
    const { getByTestId, queryByTestId } = render(
      <MobileChatMessages
        messages={fakeMessages([])}
        getMessageActions={() => null}
        nextStepActions={null}
      />,
    );
    expect(getByTestId("chat-empty")).toBeTruthy();
    expect(queryByTestId("virtuoso")).toBeNull();
  });

  it("renders each message through the reused ChatMessage on react-virtuoso", () => {
    const getMessageActions = vi.fn(() => null);
    const { getAllByTestId } = render(
      <MobileChatMessages
        messages={fakeMessages(["m1", "m2"])}
        getMessageActions={getMessageActions}
        nextStepActions={null}
      />,
    );
    expect(
      getAllByTestId("chat-message").map((node) => node.textContent),
    ).toEqual(["m1", "m2"]);
    expect(getMessageActions).toHaveBeenCalledTimes(2);
  });
});
