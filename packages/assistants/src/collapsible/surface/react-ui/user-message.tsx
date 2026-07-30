// Vendored from @assistant-ui/react-ui@0.2.1 `user-message.tsx` (see
// withDefaults.tsx for why).
import { forwardRef } from 'react';
import { MessagePrimitive } from '@assistant-ui/react';
import { BranchPicker } from './branch-picker';
import { withDefaults } from './withDefaults';
import { UserActionBar } from './user-action-bar';
import { MessagePart } from './message-part';
import { Attachment } from './attachment-ui';

const UserMessageFC = () => {
  return (
    <UserMessageRoot>
      <UserMessageAttachments />
      <MessagePrimitive.If hasContent>
        <UserActionBar />
        <UserMessageContent />
      </MessagePrimitive.If>
      <BranchPicker />
    </UserMessageRoot>
  );
};
UserMessageFC.displayName = 'UserMessage';

const UserMessageRoot = withDefaults(MessagePrimitive.Root, {
  className: 'aui-user-message-root',
});

const UserMessageContentWrapper = withDefaults('div', {
  className: 'aui-user-message-content',
});

type UserMessageContentProps = React.HTMLAttributes<HTMLDivElement> & {
  components?: Partial<
    Parameters<typeof MessagePrimitive.Content>[0]['components']
  >;
};

const UserMessageContent = forwardRef<HTMLDivElement, UserMessageContentProps>(
  ({ components, ...props }, ref) => {
    return (
      <UserMessageContentWrapper {...props} ref={ref}>
        <MessagePrimitive.Content
          components={{
            ...components,
            Text: components?.Text ?? MessagePart.Text,
          }}
        />
      </UserMessageContentWrapper>
    );
  },
);
UserMessageContent.displayName = 'UserMessageContent';

const UserMessageAttachmentsContainer = withDefaults('div', {
  className: 'aui-user-message-attachments',
});

type UserMessageAttachmentsProps = {
  components?: Partial<
    Parameters<typeof MessagePrimitive.Attachments>[0]['components']
  >;
};

const UserMessageAttachments = ({
  components,
}: UserMessageAttachmentsProps) => {
  return (
    <MessagePrimitive.If hasAttachments>
      <UserMessageAttachmentsContainer>
        <MessagePrimitive.Attachments
          components={{
            ...components,
            Attachment: components?.Attachment ?? Attachment,
          }}
        />
      </UserMessageAttachmentsContainer>
    </MessagePrimitive.If>
  );
};

export const UserMessage = Object.assign(UserMessageFC, {
  Root: UserMessageRoot,
  Content: UserMessageContent,
  Attachments: UserMessageAttachments,
});
