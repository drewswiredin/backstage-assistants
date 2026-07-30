// Vendored from @assistant-ui/react-ui@0.2.1 `assistant-message.tsx` (see
// withDefaults.tsx for why).
import { forwardRef, useMemo } from 'react';
import { MessagePrimitive } from '@assistant-ui/react';
import { BranchPicker } from './branch-picker';
import { Avatar } from './base';
import { withDefaults } from './withDefaults';
import { useThreadConfig } from './thread-config';
import { AssistantActionBar } from './assistant-action-bar';
import { MessagePart } from './message-part';

const AssistantMessageFC = () => {
  return (
    <AssistantMessageRoot>
      <AssistantMessageAvatar />
      <AssistantMessageContent />
      <BranchPicker />
      <AssistantActionBar />
    </AssistantMessageRoot>
  );
};
AssistantMessageFC.displayName = 'AssistantMessage';

const AssistantMessageAvatar = () => {
  const { assistantAvatar: avatar = { fallback: 'A' } } = useThreadConfig();
  return <Avatar {...avatar} />;
};

const AssistantMessageRoot = withDefaults(MessagePrimitive.Root, {
  className: 'aui-assistant-message-root',
});

const AssistantMessageContentWrapper = withDefaults('div', {
  className: 'aui-assistant-message-content',
});

// The primitive's `components` prop is a union (standard components vs a
// ChainOfThought override), so `Partial<>` over it collapses; type the standard
// shape we actually support and cast at the call site.
type ContentComponents = NonNullable<
  Parameters<typeof MessagePrimitive.Content>[0]['components']
>;

type AssistantMessageContentProps = React.HTMLAttributes<HTMLDivElement> & {
  components?: Omit<ContentComponents, 'tools'>;
};

const AssistantMessageContent = forwardRef<
  HTMLDivElement,
  AssistantMessageContentProps
>(({ components: componentsProp, ...rest }, ref) => {
  const { tools, assistantMessage: { components = {} } = {} } =
    useThreadConfig();
  const toolsComponents = useMemo(
    () => ({
      by_name: !tools
        ? undefined
        : Object.fromEntries(
            tools.map(t => [t.unstable_tool.toolName, t.unstable_tool.render]),
          ),
      Fallback: components.ToolFallback,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...(tools ?? []), components.ToolFallback],
  );
  const Footer = components.Footer;
  return (
    <AssistantMessageContentWrapper {...rest} ref={ref}>
      <MessagePrimitive.Content
        components={
          {
            ...componentsProp,
            Text: componentsProp?.Text ?? components.Text ?? MessagePart.Text,
            Empty: componentsProp?.Empty ?? components.Empty,
            tools: toolsComponents,
          } as ContentComponents
        }
      />
      {Footer && <Footer />}
    </AssistantMessageContentWrapper>
  );
});
AssistantMessageContent.displayName = 'AssistantMessageContent';

export const AssistantMessage = Object.assign(AssistantMessageFC, {
  Root: AssistantMessageRoot,
  Avatar: AssistantMessageAvatar,
  Content: AssistantMessageContent,
});
