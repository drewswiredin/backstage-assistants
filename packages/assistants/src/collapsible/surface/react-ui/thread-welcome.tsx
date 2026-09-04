// Vendored from @assistant-ui/react-ui@0.2.1 `thread-welcome.tsx` (see
// withDefaults.tsx for why; `useThread` selectors became `useAuiState`).
// MIT License, Copyright (c) 2025 AgentbaseAI Inc. — full license text in
// THIRD_PARTY_NOTICES.md at the package root.
import { forwardRef } from 'react';
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { withDefaults } from './withDefaults';
import { Avatar } from './base';
import { useThreadConfig, type SuggestionConfig } from './thread-config';

const ThreadWelcomeFC = () => {
  return (
    <ThreadWelcomeRoot>
      <ThreadWelcomeCenter>
        <ThreadWelcomeAvatar />
        <ThreadWelcomeMessage />
      </ThreadWelcomeCenter>
      <ThreadWelcomeSuggestions />
    </ThreadWelcomeRoot>
  );
};
ThreadWelcomeFC.displayName = 'ThreadWelcome';

const ThreadWelcomeRootStyled = withDefaults('div', {
  className: 'aui-thread-welcome-root',
});

const ThreadWelcomeCenter = withDefaults('div', {
  className: 'aui-thread-welcome-center',
});

const ThreadWelcomeRoot = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>((props, ref) => {
  return (
    <ThreadPrimitive.Empty>
      <ThreadWelcomeRootStyled {...props} ref={ref} />
    </ThreadPrimitive.Empty>
  );
});
ThreadWelcomeRoot.displayName = 'ThreadWelcomeRoot';

const ThreadWelcomeAvatar = () => {
  const { assistantAvatar: avatar = { fallback: 'A' } } = useThreadConfig();
  return <Avatar {...avatar} />;
};

const ThreadWelcomeMessageStyled = withDefaults('p', {
  className: 'aui-thread-welcome-message',
});

type ThreadWelcomeMessageProps = React.HTMLAttributes<HTMLParagraphElement> & {
  message?: string | undefined;
};

const ThreadWelcomeMessage = forwardRef<
  HTMLParagraphElement,
  ThreadWelcomeMessageProps
>(({ message: messageProp, ...rest }, ref) => {
  const {
    welcome: { message } = {},
    strings: {
      welcome: { message: defaultMessage = 'How can I help you today?' } = {},
    } = {},
  } = useThreadConfig();
  return (
    <ThreadWelcomeMessageStyled {...rest} ref={ref}>
      {messageProp ?? message ?? defaultMessage}
    </ThreadWelcomeMessageStyled>
  );
});
ThreadWelcomeMessage.displayName = 'ThreadWelcomeMessage';

const ThreadWelcomeSuggestionContainer = withDefaults('div', {
  className: 'aui-thread-welcome-suggestions',
});

const ThreadWelcomeSuggestionStyled = withDefaults(ThreadPrimitive.Suggestion, {
  className: 'aui-thread-welcome-suggestion',
});

const ThreadWelcomeSuggestion = ({
  suggestion: { text, prompt },
}: {
  suggestion: SuggestionConfig;
}) => {
  return (
    <ThreadWelcomeSuggestionStyled prompt={prompt} method="replace" autoSend>
      <span className="aui-thread-welcome-suggestion-text">
        {text ?? prompt}
      </span>
    </ThreadWelcomeSuggestionStyled>
  );
};

const ThreadWelcomeSuggestions = () => {
  const threadSuggestions = useAuiState(s => s.thread.suggestions);
  const { welcome: { suggestions } = {} } = useThreadConfig();
  const finalSuggestions = threadSuggestions.length
    ? threadSuggestions
    : suggestions;
  return (
    <ThreadWelcomeSuggestionContainer>
      {finalSuggestions?.map((suggestion, idx) => {
        const key = `${suggestion.prompt}-${idx}`;
        return <ThreadWelcomeSuggestion key={key} suggestion={suggestion} />;
      })}
    </ThreadWelcomeSuggestionContainer>
  );
};
ThreadWelcomeSuggestions.displayName = 'ThreadWelcomeSuggestions';

export const ThreadWelcome = Object.assign(ThreadWelcomeFC, {
  Root: ThreadWelcomeRoot,
  Center: ThreadWelcomeCenter,
  Avatar: ThreadWelcomeAvatar,
  Message: ThreadWelcomeMessage,
  Suggestions: ThreadWelcomeSuggestions,
  Suggestion: ThreadWelcomeSuggestion,
});
