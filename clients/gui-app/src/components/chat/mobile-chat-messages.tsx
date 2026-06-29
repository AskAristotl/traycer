import type { ReactNode } from "react";
import { Virtuoso } from "react-virtuoso";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import {
  ChatMessage,
  type ChatMessageActions,
} from "@/components/chat/chat-message";
import type { NextStepActionHandler } from "@/components/chat/segments/next-steps-action-group";
import type { ChatMessage as ChatMessageModel } from "@/stores/composer/chat-store";
import { ActivityGroupOpenStoreProvider } from "@/stores/chats/activity-group-open-store";

export interface MobileChatMessagesProps {
  readonly messages: ReadonlyArray<ChatMessageModel>;
  readonly getMessageActions: (
    message: ChatMessageModel,
  ) => ChatMessageActions | null;
  readonly nextStepActions: NextStepActionHandler | null;
}

interface MobileChatRowContext {
  readonly getMessageActions: (
    message: ChatMessageModel,
  ) => ChatMessageActions | null;
  readonly nextStepActions: NextStepActionHandler | null;
}

// Module-level (stable) so react-virtuoso doesn't see a new component type each
// render. Per-message callbacks travel through the list `context`.
function MobileChatHeader(): ReactNode {
  return <div aria-hidden="true" className="h-6" />;
}

function MobileChatFooter(): ReactNode {
  return <div aria-hidden="true" className="h-6" />;
}

const MOBILE_CHAT_COMPONENTS = {
  Header: MobileChatHeader,
  Footer: MobileChatFooter,
};

function renderMobileChatRow(
  _index: number,
  message: ChatMessageModel,
  context: MobileChatRowContext,
): ReactNode {
  return (
    <div
      data-message-id={message.id}
      className="mx-auto w-full max-w-3xl px-4 pb-6"
    >
      <ChatMessage
        message={message}
        actions={context.getMessageActions(message)}
        nextStepActions={context.nextStepActions}
      />
    </div>
  );
}

/**
 * Mobile chat transcript on the FREE, MIT-licensed `react-virtuoso` instead of
 * the commercial `@virtuoso.dev/message-list`. The paid component only unlocks
 * on localhost/dev hostnames, so it blocks the tailnet-served PWA; this avoids
 * the licence entirely while reusing the exact `<ChatMessage>` rendering.
 *
 * `followOutput="auto"` keeps the list pinned to the newest message while a
 * turn streams (when the reader is already at the bottom). It drops the paid
 * component's extras (minimap rail, scroll-anchored history prepend), which the
 * phone surface does not need. Desktop keeps the paid path unchanged.
 *
 * `ChatMessage` requires the activity-group open store; the measured-item
 * context falls back to its no-op default (react-virtuoso owns measurement).
 */
export function MobileChatMessages(props: MobileChatMessagesProps): ReactNode {
  const { messages, getMessageActions, nextStepActions } = props;

  if (messages.length === 0) {
    return (
      <div
        className="relative flex-1 overflow-hidden"
        data-testid="mobile-chat-empty"
      >
        <ChatEmptyState />
      </div>
    );
  }

  return (
    <ActivityGroupOpenStoreProvider>
      <div
        className="relative flex-1 overflow-hidden"
        data-testid="mobile-chat-messages"
      >
        <Virtuoso<ChatMessageModel, MobileChatRowContext>
          data={messages}
          context={{ getMessageActions, nextStepActions }}
          followOutput="auto"
          initialTopMostItemIndex={Math.max(messages.length - 1, 0)}
          className="chat-scrollbar-native-thin h-full overflow-y-auto"
          components={MOBILE_CHAT_COMPONENTS}
          itemContent={renderMobileChatRow}
        />
      </div>
    </ActivityGroupOpenStoreProvider>
  );
}
