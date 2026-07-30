// Vendored from @assistant-ui/react-ui@0.2.1 `thread-config.tsx` (see
// withDefaults.tsx for why). Deviation: the upstream `runtime` config (which
// wrapped children in an AssistantRuntimeProvider) is dropped — this surface is
// always "bring your own runtime", and the hook upstream used for the guard
// (`useAssistantRuntime`) no longer exists on the 0.15 line.
import {
  createContext,
  useContext,
  type ComponentType,
  type FC,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import type {
  AssistantToolUI,
  EmptyMessagePartComponent,
  TextMessagePartComponent,
  ToolCallMessagePartProps,
} from '@assistant-ui/react';
import type { AvatarProps } from './base';

export type SuggestionConfig = {
  text?: ReactNode | undefined;
  prompt: string;
};

export type ThreadWelcomeConfig = {
  message?: string | null | undefined;
  suggestions?: SuggestionConfig[] | undefined;
};

export type UserMessageConfig = {
  allowEdit?: boolean | undefined;
};

export type AssistantMessageConfig = {
  allowReload?: boolean | undefined;
  allowCopy?: boolean | undefined;
  allowSpeak?: boolean | undefined;
  allowFeedbackPositive?: boolean | undefined;
  allowFeedbackNegative?: boolean | undefined;
  components?:
    | {
        Text?: TextMessagePartComponent | undefined;
        Empty?: EmptyMessagePartComponent | undefined;
        ToolFallback?: ComponentType<ToolCallMessagePartProps> | undefined;
        Footer?: ComponentType | undefined;
      }
    | undefined;
};

export type BranchPickerConfig = {
  allowBranchPicker?: boolean | undefined;
};

export type ComposerConfig = {
  allowAttachments?: boolean | undefined;
};

export type StringsConfig = {
  thread?: {
    scrollToBottom?: { tooltip?: string | undefined };
  };
  welcome?: {
    message?: string | undefined;
  };
  userMessage?: {
    edit?: { tooltip?: string | undefined };
  };
  assistantMessage?: {
    reload?: { tooltip?: string | undefined };
    copy?: { tooltip?: string | undefined };
    speak?: {
      tooltip?: string | undefined;
      stop?: { tooltip?: string | undefined };
    };
    feedback?: {
      positive?: { tooltip?: string | undefined };
      negative?: { tooltip?: string | undefined };
    };
  };
  branchPicker?: {
    previous?: { tooltip?: string | undefined };
    next?: { tooltip?: string | undefined };
  };
  composer?: {
    send?: { tooltip?: string | undefined } | undefined;
    cancel?: { tooltip?: string | undefined } | undefined;
    addAttachment?: { tooltip?: string | undefined } | undefined;
    removeAttachment?: { tooltip?: string | undefined };
    input?: { placeholder?: string | undefined };
  };
  editComposer?: {
    send?: { label?: string | undefined };
    cancel?: { label?: string | undefined };
  };
  code?: {
    header?: { copy?: { tooltip?: string | undefined } };
  };
};

export type ThreadConfig = {
  assistantAvatar?: AvatarProps | undefined;
  welcome?: ThreadWelcomeConfig | undefined;
  assistantMessage?: AssistantMessageConfig | undefined;
  userMessage?: UserMessageConfig | undefined;
  branchPicker?: BranchPickerConfig | undefined;
  composer?: ComposerConfig | undefined;
  strings?: StringsConfig | undefined;
  tools?: AssistantToolUI[] | undefined;
  components?:
    | {
        UserMessage?: ComponentType | undefined;
        AssistantMessage?: ComponentType | undefined;
        EditComposer?: ComponentType | undefined;
        Composer?: ComponentType | undefined;
        ThreadWelcome?: ComponentType | undefined;
        MessagesFooter?: ComponentType | undefined;
      }
    | undefined;
};

const ThreadConfigContext = createContext<ThreadConfig>({});

export const useThreadConfig = (): ThreadConfig => {
  return useContext(ThreadConfigContext);
};

export type ThreadConfigProviderProps = PropsWithChildren<{
  config?: ThreadConfig | undefined;
}>;

export const ThreadConfigProvider: FC<ThreadConfigProviderProps> = ({
  children,
  config,
}) => {
  const hasConfig = config && Object.keys(config).length > 0;
  const outerConfig = useThreadConfig();
  if (hasConfig && Object.keys(outerConfig).length > 0) {
    throw new Error(
      'You are providing ThreadConfig to several nested components. Please provide all configuration to the same component.',
    );
  }
  if (!hasConfig) return <>{children}</>;
  return (
    <ThreadConfigContext.Provider value={config}>
      {children}
    </ThreadConfigContext.Provider>
  );
};
ThreadConfigProvider.displayName = 'ThreadConfigProvider';
