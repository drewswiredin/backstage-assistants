// Vendored from @assistant-ui/react-ui@0.2.1 `edit-composer.tsx` (see
// withDefaults.tsx for why).
// MIT License, Copyright (c) 2025 AgentbaseAI Inc. — /THIRD_PARTY_NOTICES.md.
import { forwardRef } from 'react';
import { ComposerPrimitive } from '@assistant-ui/react';
import { Button, type ButtonProps } from './base';
import { withDefaults } from './withDefaults';
import { useThreadConfig } from './thread-config';

const EditComposerFC = () => {
  return (
    <EditComposerRoot>
      <EditComposerInput />
      <EditComposerFooter>
        <EditComposerCancel />
        <EditComposerSend />
      </EditComposerFooter>
    </EditComposerRoot>
  );
};
EditComposerFC.displayName = 'EditComposer';

const EditComposerRoot = withDefaults(ComposerPrimitive.Root, {
  className: 'aui-edit-composer-root',
});

const EditComposerInput = withDefaults(ComposerPrimitive.Input, {
  className: 'aui-edit-composer-input',
});

const EditComposerFooter = withDefaults('div', {
  className: 'aui-edit-composer-footer',
});

const EditComposerCancel = forwardRef<HTMLButtonElement, Partial<ButtonProps>>(
  (props, ref) => {
    const {
      strings: {
        editComposer: { cancel: { label = 'Cancel' } = {} } = {},
      } = {},
    } = useThreadConfig();
    return (
      <ComposerPrimitive.Cancel asChild>
        <Button variant="ghost" {...props} ref={ref}>
          {props.children ?? label}
        </Button>
      </ComposerPrimitive.Cancel>
    );
  },
);
EditComposerCancel.displayName = 'EditComposerCancel';

const EditComposerSend = forwardRef<HTMLButtonElement, Partial<ButtonProps>>(
  (props, ref) => {
    const {
      strings: { editComposer: { send: { label = 'Send' } = {} } = {} } = {},
    } = useThreadConfig();
    return (
      <ComposerPrimitive.Send asChild>
        <Button {...props} ref={ref}>
          {props.children ?? label}
        </Button>
      </ComposerPrimitive.Send>
    );
  },
);
EditComposerSend.displayName = 'EditComposerSend';

export const EditComposer = Object.assign(EditComposerFC, {
  Root: EditComposerRoot,
  Input: EditComposerInput,
  Footer: EditComposerFooter,
  Cancel: EditComposerCancel,
  Send: EditComposerSend,
});
