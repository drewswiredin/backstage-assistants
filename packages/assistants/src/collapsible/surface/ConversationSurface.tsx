// The prebuilt react-ui `<Thread>` stylesheet is vendored locally under
// `styles/` and imported once at the top of `CollapsiblePage.tsx`. It is NOT
// imported here: react-ui's `sideEffects: false` lets bundlers tree-shake a
// bare CSS import from inside a lazily-loaded component, which left the Thread
// unstyled.
import { createContext, useContext, useEffect, useState } from 'react';
import type { ProfileInfo } from '@backstage/core-plugin-api';
import { identityApiRef, useApi } from '@backstage/core-plugin-api';
import { Avatar as BackstageAvatar } from '@backstage/core-components';
import { makeStyles } from '@material-ui/core/styles';
import { Button, Typography } from '@material-ui/core';
import { BackstageLogo } from './BackstageLogo';
import { DEFAULT_AVATAR_COLOR } from './AssistantAvatar';
import { ThreadPrimitive } from '@assistant-ui/react';
import {
  AssistantActionBar,
  AssistantMessage,
  BranchPicker,
  Thread,
  ThreadWelcome,
  UserMessage,
} from '@assistant-ui/react-ui';
import { MarkdownText } from './MarkdownText';
import { ReasoningPart, ThinkingMessage, ToolFallback } from './parts';

const DEFAULT_WELCOME_SUBTITLE =
  'Ask me about services, APIs, teams, TechDocs, or anything in the catalog.';

// The active assistant's avatar color. ConversationSurface provides it; the
// message components (passed to <Thread> by reference, so they can't take props)
// read it from context. Falls back to DEFAULT_AVATAR_COLOR.
const AvatarColorContext = createContext<string | undefined>(undefined);

const useStyles = makeStyles(theme => ({
  threadHost: {
    flex: 1,
    minHeight: 0,
    '& .aui-thread-root': {
      '--aui-thread-max-width': '80%',
      '--aui-background':
        theme.palette.type === 'dark' ? '0 0% 18%' : '0 0% 100%',
      '--aui-foreground':
        theme.palette.type === 'dark' ? '0 0% 98%' : '240 10% 3.9%',
      '--aui-muted':
        theme.palette.type === 'dark' ? '0 0% 24%' : '240 4.8% 95.9%',
      '--aui-muted-foreground':
        theme.palette.type === 'dark' ? '0 0% 70%' : '240 3.8% 46.1%',
      '--aui-accent':
        theme.palette.type === 'dark' ? '0 0% 24%' : '240 4.8% 95.9%',
      '--aui-accent-foreground':
        theme.palette.type === 'dark' ? '0 0% 98%' : '240 5.9% 10%',
      '--aui-border':
        theme.palette.type === 'dark' ? '0 0% 40%' : '240 5.9% 90%',
      '--aui-input':
        theme.palette.type === 'dark' ? '0 0% 40%' : '240 5.9% 90%',
      '--aui-ring':
        theme.palette.type === 'dark' ? '207 90% 68%' : '210 90% 45%',
      '--aui-primary':
        theme.palette.type === 'dark' ? '0 0% 98%' : '240 5.9% 10%',
      '--aui-primary-foreground':
        theme.palette.type === 'dark' ? '240 5.9% 10%' : '0 0% 98%',
    },
    '& .aui-composer-root:focus-within': {
      borderColor: theme.palette.primary.main,
      boxShadow: `0 0 0 1px ${theme.palette.primary.main}`,
    },
    '& .aui-assistant-message-content': {
      maxWidth: '100%',
      width: '100%',
    },
  },
  botAvatar: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Transparent so the tinted logo floats (overrides react-ui's aui-avatar-root).
    backgroundColor: 'transparent',
  },
  botLogo: {
    width: 16,
    height: 'auto',
  },
  userMessageWithAvatar: {
    display: 'flex',
    width: '100%',
    maxWidth: 'var(--aui-thread-max-width)',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: theme.spacing(0.5),
    paddingTop: theme.spacing(1),
    paddingBottom: theme.spacing(1),
  },
  userMessageBody: {
    display: 'flex',
    maxWidth: '80%',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    '& .aui-user-message-content': {
      maxWidth: '100%',
    },
  },
  userAvatar: {
    width: theme.spacing(5),
    height: theme.spacing(5),
    marginTop: theme.spacing(0.25),
    flexShrink: 0,
  },
  welcomeRoot: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(2),
    maxWidth: '28rem',
    textAlign: 'center',
  },
  welcomeLogo: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
  },
  welcomeLogoIcon: {
    width: 30,
    height: 'auto',
  },
  welcomeGreeting: {
    fontWeight: 500,
    color: theme.palette.text.primary,
  },
  welcomeSubtitle: {
    color: theme.palette.text.secondary,
  },
  suggestions: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
  suggestionButton: {
    textTransform: 'none',
    borderRadius: 999,
  },
}));

/** A circular MUI-styled bot avatar (no host asset dependency). */
function AssistantBotAvatar() {
  const classes = useStyles();
  const color = useContext(AvatarColorContext) ?? DEFAULT_AVATAR_COLOR;

  return (
    <span
      className={`aui-avatar-root ${classes.botAvatar}`}
      style={{ color, backgroundColor: 'transparent' }}
      aria-label="Backstage assistant"
      role="img"
    >
      <BackstageLogo className={classes.botLogo} />
    </span>
  );
}

function AssistantMessageWithAvatar() {
  return (
    <AssistantMessage.Root>
      <AssistantBotAvatar />
      <AssistantMessage.Content components={{ Reasoning: ReasoningPart }} />
      <BranchPicker />
      <AssistantActionBar />
    </AssistantMessage.Root>
  );
}

/** Read the signed-in user's profile (display name, picture) once. */
function useProfile() {
  const identityApi = useApi(identityApiRef);
  const [profile, setProfile] = useState<ProfileInfo>();

  useEffect(() => {
    let mounted = true;

    identityApi.getProfileInfo().then(value => {
      if (mounted) {
        setProfile(value);
      }
    });

    return () => {
      mounted = false;
    };
  }, [identityApi]);

  return profile;
}

function UserChatAvatar() {
  const classes = useStyles();
  const profile = useProfile();

  return (
    <BackstageAvatar
      classes={{ avatar: classes.userAvatar }}
      displayName={profile?.displayName ?? profile?.email ?? 'You'}
      picture={profile?.picture}
    />
  );
}

function UserMessageWithAvatar() {
  const classes = useStyles();

  return (
    <UserMessage.Root className={classes.userMessageWithAvatar}>
      <UserMessage.Attachments />
      <div className={classes.userMessageBody}>
        <UserMessage.Content />
        <UserChatAvatar />
      </div>
    </UserMessage.Root>
  );
}

/**
 * Props for {@link ConversationSurface}.
 *
 * @public
 */
export interface ConversationSurfaceProps {
  /** Placeholder text for the composer input (from the assistant's ui config). */
  composerPlaceholder?: string;
  /** Starter prompts shown as clickable chips on the empty thread. */
  suggestions?: Array<{ title: string; prompt: string }>;
  /** Overrides for the default empty-thread greeting. */
  welcome?: { title?: string; subtitle?: string };
  /** The active assistant's avatar tint (hex); defaults to Backstage teal. */
  assistantColor?: string;
  /** Host layout escape hatch (applied alongside the themed thread host). */
  className?: string;
}

/**
 * The react-ui `<Thread>` rendered with Implementation 1's custom message
 * components: a bot-avatar assistant message, an avatar'd user message,
 * Markdown (with streaming-safe Mermaid), a tool-call fallback, a thinking /
 * error empty-state, and a personalized empty-thread welcome with optional
 * starter-prompt chips.
 *
 * This is a "bring your own runtime" surface — it expects an
 * `AssistantRuntimeProvider` higher in the tree.
 *
 * @public
 */
export function ConversationSurface(props: ConversationSurfaceProps) {
  const { composerPlaceholder, suggestions, welcome, assistantColor, className } =
    props;
  const classes = useStyles();

  function EmptyThreadWelcome() {
    const profile = useProfile();
    const firstName = profile?.displayName?.split(' ')[0] ?? 'there';

    const title = welcome?.title ?? `Hi ${firstName}, welcome to Backstage`;
    const subtitle = welcome?.subtitle ?? DEFAULT_WELCOME_SUBTITLE;

    return (
      <ThreadWelcome.Root>
        <ThreadWelcome.Center>
          <div className={classes.welcomeRoot}>
            <span
              className={classes.welcomeLogo}
              style={{ color: assistantColor ?? DEFAULT_AVATAR_COLOR }}
              aria-hidden="true"
            >
              <BackstageLogo className={classes.welcomeLogoIcon} />
            </span>
            <Typography variant="h5" className={classes.welcomeGreeting}>
              {title}
            </Typography>
            <Typography variant="body2" className={classes.welcomeSubtitle}>
              {subtitle}
            </Typography>
            {suggestions && suggestions.length > 0 && (
              <div className={classes.suggestions}>
                {suggestions.map(suggestion => (
                  <ThreadPrimitive.Suggestion
                    key={suggestion.prompt}
                    prompt={suggestion.prompt}
                    send
                    asChild
                  >
                    <Button
                      variant="outlined"
                      size="small"
                      className={classes.suggestionButton}
                    >
                      {suggestion.title}
                    </Button>
                  </ThreadPrimitive.Suggestion>
                ))}
              </div>
            )}
          </div>
        </ThreadWelcome.Center>
      </ThreadWelcome.Root>
    );
  }

  return (
    <AvatarColorContext.Provider value={assistantColor}>
      <div className={`${classes.threadHost} ${className ?? ''}`}>
        <Thread
          strings={
          composerPlaceholder
            ? { composer: { input: { placeholder: composerPlaceholder } } }
            : undefined
        }
        components={{
          AssistantMessage: AssistantMessageWithAvatar,
          ThreadWelcome: EmptyThreadWelcome,
          UserMessage: UserMessageWithAvatar,
        }}
          assistantMessage={{
            components: {
              Text: MarkdownText,
              Empty: ThinkingMessage,
              ToolFallback,
            },
          }}
        />
      </div>
    </AvatarColorContext.Provider>
  );
}
