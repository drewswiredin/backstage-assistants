// Vendored from @assistant-ui/react-ui@0.2.1 `thread.tsx` (see withDefaults.tsx
// for why; `useThread` selectors became `useAuiState`).
// MIT License, Copyright (c) 2025 AgentbaseAI Inc. — full license text in
// THIRD_PARTY_NOTICES.md at the package root.
import { forwardRef, type ComponentType, type FC } from 'react';
import { ArrowDownIcon } from 'lucide-react';
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { withDefaults } from './withDefaults';
import { Composer } from './composer';
import { ThreadWelcome } from './thread-welcome';
import { TooltipIconButton, type TooltipIconButtonProps } from './base';
import { AssistantMessage } from './assistant-message';
import { UserMessage } from './user-message';
import { EditComposer } from './edit-composer';
import {
  ThreadConfigProvider,
  useThreadConfig,
  type ThreadConfig,
} from './thread-config';

const ThreadFC: FC<ThreadConfig> = config => {
  const {
    components: {
      Composer: ComposerComponent = Composer,
      ThreadWelcome: ThreadWelcomeComponent = ThreadWelcome,
      MessagesFooter,
      ...messageComponents
    } = {},
  } = config;
  return (
    <ThreadRoot config={config}>
      <ThreadViewport>
        <ThreadWelcomeComponent />
        <ThreadMessages
          MessagesFooter={MessagesFooter}
          components={messageComponents}
        />
        <ThreadFollowupSuggestions />
        <ThreadViewportFooter>
          <ThreadScrollToBottom />
          <ComposerComponent />
        </ThreadViewportFooter>
      </ThreadViewport>
    </ThreadRoot>
  );
};

const ThreadRootStyled = withDefaults(ThreadPrimitive.Root, {
  className: 'aui-root aui-thread-root',
});

type ThreadRootProps = React.ComponentPropsWithoutRef<
  typeof ThreadRootStyled
> & {
  config?: ThreadConfig | undefined;
};

const ThreadRoot = forwardRef<HTMLDivElement, ThreadRootProps>(
  ({ config, ...props }, ref) => {
    return (
      <ThreadConfigProvider config={config}>
        <ThreadRootStyled {...props} ref={ref} />
      </ThreadConfigProvider>
    );
  },
);
ThreadRoot.displayName = 'ThreadRoot';

const ThreadViewport = withDefaults(ThreadPrimitive.Viewport, {
  className: 'aui-thread-viewport',
});

const ThreadViewportFooter = withDefaults('div', {
  className: 'aui-thread-viewport-footer',
});

type ThreadMessagesProps = {
  unstable_flexGrowDiv?: boolean;
  components?: Partial<
    Parameters<typeof ThreadPrimitive.Messages>[0]['components']
  >;
  MessagesFooter?: ComponentType | undefined;
};

const ThreadMessages: FC<ThreadMessagesProps> = ({
  components,
  MessagesFooter,
  unstable_flexGrowDiv: flexGrowDiv = true,
  ...rest
}) => {
  return (
    <>
      <ThreadPrimitive.Messages
        components={{
          ...components,
          UserMessage: components?.UserMessage ?? UserMessage,
          AssistantMessage: components?.AssistantMessage ?? AssistantMessage,
          EditComposer: components?.EditComposer ?? EditComposer,
        }}
        {...rest}
      />
      {MessagesFooter && <MessagesFooter />}
      {flexGrowDiv && (
        <ThreadPrimitive.If empty={false}>
          <div style={{ flexGrow: 1 }} />
        </ThreadPrimitive.If>
      )}
    </>
  );
};
ThreadMessages.displayName = 'ThreadMessages';

const ThreadFollowupSuggestions: FC = () => {
  const suggestions = useAuiState(s => s.thread.suggestions);
  return (
    <ThreadPrimitive.If empty={false} running={false}>
      <div className="aui-thread-followup-suggestions">
        {suggestions?.map((suggestion, idx) => (
          <ThreadPrimitive.Suggestion
            key={idx}
            className="aui-thread-followup-suggestion"
            prompt={suggestion.prompt}
            method="replace"
            autoSend
          >
            {suggestion.prompt}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </ThreadPrimitive.If>
  );
};

const ThreadScrollToBottomIconButton = withDefaults(TooltipIconButton, {
  variant: 'outline',
  className: 'aui-thread-scroll-to-bottom',
});

const ThreadScrollToBottom = forwardRef<
  HTMLButtonElement,
  Partial<TooltipIconButtonProps>
>((props, ref) => {
  const {
    strings: {
      thread: { scrollToBottom: { tooltip = 'Scroll to bottom' } = {} } = {},
    } = {},
  } = useThreadConfig();
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <ThreadScrollToBottomIconButton tooltip={tooltip} {...props} ref={ref}>
        {props.children ?? <ArrowDownIcon />}
      </ThreadScrollToBottomIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
});
ThreadScrollToBottom.displayName = 'ThreadScrollToBottom';

export const Thread = Object.assign(ThreadFC, {
  Root: ThreadRoot,
  Viewport: ThreadViewport,
  Messages: ThreadMessages,
  FollowupSuggestions: ThreadFollowupSuggestions,
  ScrollToBottom: ThreadScrollToBottom,
  ViewportFooter: ThreadViewportFooter,
});
