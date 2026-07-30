// Vendored from @assistant-ui/react-ui@0.2.1 `composer.tsx` (see
// withDefaults.tsx for why; `useThread` selectors became `useAuiState`).
import { forwardRef } from 'react';
import { PaperclipIcon, SendHorizontalIcon } from 'lucide-react';
import {
  ComposerPrimitive,
  ThreadPrimitive,
  useAuiState,
} from '@assistant-ui/react';
import { withDefaults } from './withDefaults';
import { useThreadConfig } from './thread-config';
import {
  CircleStopIcon,
  TooltipIconButton,
  type TooltipIconButtonProps,
} from './base';
import { Attachment } from './attachment-ui';

const useAllowAttachments = (ensureCapability = false) => {
  const { composer: { allowAttachments = true } = {} } = useThreadConfig();
  const attachmentsSupported = useAuiState(
    s => s.thread.capabilities.attachments,
  );
  return allowAttachments && (!ensureCapability || attachmentsSupported);
};

const ComposerFC = () => {
  const allowAttachments = useAllowAttachments(true);
  return (
    <ComposerRoot>
      {allowAttachments && <ComposerAttachments />}
      {allowAttachments && <ComposerAddAttachment />}
      <ComposerInput autoFocus />
      <ComposerAction />
    </ComposerRoot>
  );
};
ComposerFC.displayName = 'Composer';

const ComposerRoot = withDefaults(ComposerPrimitive.Root, {
  className: 'aui-composer-root',
});

const ComposerInputStyled = withDefaults(ComposerPrimitive.Input, {
  rows: 1,
  autoFocus: true,
  className: 'aui-composer-input',
});

const ComposerInput = forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<typeof ComposerInputStyled>
>((props, ref) => {
  const {
    strings: {
      composer: { input: { placeholder = 'Write a message...' } = {} } = {},
    } = {},
  } = useThreadConfig();
  return <ComposerInputStyled placeholder={placeholder} {...props} ref={ref} />;
});
ComposerInput.displayName = 'ComposerInput';

const ComposerAttachmentsContainer = withDefaults('div', {
  className: 'aui-composer-attachments',
});

type ComposerAttachmentsProps = {
  components?: Partial<
    Parameters<typeof ComposerPrimitive.Attachments>[0]['components']
  >;
};

const ComposerAttachments = ({ components }: ComposerAttachmentsProps) => {
  return (
    <ComposerAttachmentsContainer>
      <ComposerPrimitive.Attachments
        components={{
          ...components,
          Attachment: components?.Attachment ?? Attachment,
        }}
      />
    </ComposerAttachmentsContainer>
  );
};

const ComposerAttachButton = withDefaults(TooltipIconButton, {
  variant: 'default',
  className: 'aui-composer-attach',
});

const ComposerAddAttachment = forwardRef<
  HTMLButtonElement,
  Partial<TooltipIconButtonProps>
>((props, ref) => {
  const {
    strings: {
      composer: { addAttachment: { tooltip = 'Attach file' } = {} } = {},
    } = {},
  } = useThreadConfig();
  const allowAttachments = useAllowAttachments();
  return (
    <ComposerPrimitive.AddAttachment disabled={!allowAttachments} asChild>
      <ComposerAttachButton
        tooltip={tooltip}
        variant="ghost"
        {...props}
        ref={ref}
      >
        {props.children ?? <PaperclipIcon />}
      </ComposerAttachButton>
    </ComposerPrimitive.AddAttachment>
  );
});
ComposerAddAttachment.displayName = 'ComposerAddAttachment';

const useAllowCancel = () => {
  const cancelSupported = useAuiState(s => s.thread.capabilities.cancel);
  return cancelSupported;
};

const ComposerAction = () => {
  const allowCancel = useAllowCancel();
  if (!allowCancel) return <ComposerSend />;
  return (
    <>
      <ThreadPrimitive.If running={false}>
        <ComposerSend />
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerCancel />
      </ThreadPrimitive.If>
    </>
  );
};
ComposerAction.displayName = 'ComposerAction';

const ComposerSendButton = withDefaults(TooltipIconButton, {
  variant: 'default',
  className: 'aui-composer-send',
});

const ComposerSend = forwardRef<
  HTMLButtonElement,
  Partial<TooltipIconButtonProps>
>((props, ref) => {
  const {
    strings: { composer: { send: { tooltip = 'Send' } = {} } = {} } = {},
  } = useThreadConfig();
  return (
    <ComposerPrimitive.Send asChild>
      <ComposerSendButton tooltip={tooltip} {...props} ref={ref}>
        {props.children ?? <SendHorizontalIcon />}
      </ComposerSendButton>
    </ComposerPrimitive.Send>
  );
});
ComposerSend.displayName = 'ComposerSend';

const ComposerCancelButton = withDefaults(TooltipIconButton, {
  variant: 'default',
  className: 'aui-composer-cancel',
});

const ComposerCancel = forwardRef<
  HTMLButtonElement,
  Partial<TooltipIconButtonProps>
>((props, ref) => {
  const {
    strings: { composer: { cancel: { tooltip = 'Cancel' } = {} } = {} } = {},
  } = useThreadConfig();
  return (
    <ComposerPrimitive.Cancel asChild>
      <ComposerCancelButton tooltip={tooltip} {...props} ref={ref}>
        {props.children ?? <CircleStopIcon />}
      </ComposerCancelButton>
    </ComposerPrimitive.Cancel>
  );
});
ComposerCancel.displayName = 'ComposerCancel';

export const Composer = Object.assign(ComposerFC, {
  Root: ComposerRoot,
  Input: ComposerInput,
  Action: ComposerAction,
  Send: ComposerSend,
  Cancel: ComposerCancel,
  AddAttachment: ComposerAddAttachment,
  Attachments: ComposerAttachments,
});
