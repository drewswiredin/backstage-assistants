// Vendored from @assistant-ui/react-ui@0.2.1 `user-action-bar.tsx` (see
// withDefaults.tsx for why; `useThread` selectors became `useAuiState`).
// MIT License, Copyright (c) 2025 AgentbaseAI Inc. — /THIRD_PARTY_NOTICES.md.
import { forwardRef } from 'react';
import { PencilIcon } from 'lucide-react';
import { ActionBarPrimitive, useAuiState } from '@assistant-ui/react';
import { TooltipIconButton, type TooltipIconButtonProps } from './base';
import { withDefaults } from './withDefaults';
import { useThreadConfig } from './thread-config';

const useAllowEdit = (ensureCapability = false) => {
  const { userMessage: { allowEdit = true } = {} } = useThreadConfig();
  const editSupported = useAuiState(s => s.thread.capabilities.edit);
  return allowEdit && (!ensureCapability || editSupported);
};

const UserActionBarFC = () => {
  const allowEdit = useAllowEdit(true);
  if (!allowEdit) return null;
  return (
    <UserActionBarRoot hideWhenRunning autohide="not-last">
      <UserActionBarEdit />
    </UserActionBarRoot>
  );
};
UserActionBarFC.displayName = 'UserActionBar';

const UserActionBarRoot = withDefaults(ActionBarPrimitive.Root, {
  className: 'aui-user-action-bar-root',
});

const UserActionBarEdit = forwardRef<
  HTMLButtonElement,
  Partial<TooltipIconButtonProps>
>((props, ref) => {
  const {
    strings: { userMessage: { edit: { tooltip = 'Edit' } = {} } = {} } = {},
  } = useThreadConfig();
  const allowEdit = useAllowEdit();
  return (
    <ActionBarPrimitive.Edit disabled={!allowEdit} asChild>
      <TooltipIconButton tooltip={tooltip} {...props} ref={ref}>
        {props.children ?? <PencilIcon />}
      </TooltipIconButton>
    </ActionBarPrimitive.Edit>
  );
});
UserActionBarEdit.displayName = 'UserActionBarEdit';

export const UserActionBar = Object.assign(UserActionBarFC, {
  Root: UserActionBarRoot,
  Edit: UserActionBarEdit,
});
