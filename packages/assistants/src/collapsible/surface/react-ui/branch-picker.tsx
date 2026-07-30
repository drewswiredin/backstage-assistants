// Vendored from @assistant-ui/react-ui@0.2.1 `branch-picker.tsx` (see
// withDefaults.tsx for why; `useThread` selectors became `useAuiState`).
// MIT License, Copyright (c) 2025 AgentbaseAI Inc. — /THIRD_PARTY_NOTICES.md.
import { forwardRef } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { BranchPickerPrimitive, useAuiState } from '@assistant-ui/react';
import { TooltipIconButton, type TooltipIconButtonProps } from './base';
import { withDefaults } from './withDefaults';
import { useThreadConfig } from './thread-config';

const useAllowBranchPicker = (ensureCapability = false) => {
  const { branchPicker: { allowBranchPicker = true } = {} } = useThreadConfig();
  const branchPickerSupported = useAuiState(s => s.thread.capabilities.edit);
  return allowBranchPicker && (!ensureCapability || branchPickerSupported);
};

const BranchPickerFC = () => {
  const allowBranchPicker = useAllowBranchPicker(true);
  if (!allowBranchPicker) return null;
  return (
    <BranchPickerRoot hideWhenSingleBranch>
      <BranchPickerPrevious />
      <BranchPickerState />
      <BranchPickerNext />
    </BranchPickerRoot>
  );
};
BranchPickerFC.displayName = 'BranchPicker';

const BranchPickerRoot = withDefaults(BranchPickerPrimitive.Root, {
  className: 'aui-branch-picker-root',
});

const BranchPickerPrevious = forwardRef<
  HTMLButtonElement,
  Partial<TooltipIconButtonProps>
>((props, ref) => {
  const {
    strings: {
      branchPicker: { previous: { tooltip = 'Previous' } = {} } = {},
    } = {},
  } = useThreadConfig();
  const allowBranchPicker = useAllowBranchPicker();
  return (
    <BranchPickerPrimitive.Previous disabled={!allowBranchPicker} asChild>
      <TooltipIconButton tooltip={tooltip} {...props} ref={ref}>
        {props.children ?? <ChevronLeftIcon />}
      </TooltipIconButton>
    </BranchPickerPrimitive.Previous>
  );
});
BranchPickerPrevious.displayName = 'BranchPickerPrevious';

const BranchPickerStateWrapper = withDefaults('span', {
  className: 'aui-branch-picker-state',
});

const BranchPickerState = forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>((props, ref) => {
  return (
    <BranchPickerStateWrapper {...props} ref={ref}>
      <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
    </BranchPickerStateWrapper>
  );
});
BranchPickerState.displayName = 'BranchPickerState';

const BranchPickerNext = forwardRef<
  HTMLButtonElement,
  Partial<TooltipIconButtonProps>
>((props, ref) => {
  const {
    strings: { branchPicker: { next: { tooltip = 'Next' } = {} } = {} } = {},
  } = useThreadConfig();
  const allowBranchPicker = useAllowBranchPicker();
  return (
    <BranchPickerPrimitive.Next disabled={!allowBranchPicker} asChild>
      <TooltipIconButton tooltip={tooltip} {...props} ref={ref}>
        {props.children ?? <ChevronRightIcon />}
      </TooltipIconButton>
    </BranchPickerPrimitive.Next>
  );
});
BranchPickerNext.displayName = 'BranchPickerNext';

export const BranchPicker = Object.assign(BranchPickerFC, {
  Root: BranchPickerRoot,
  Previous: BranchPickerPrevious,
  Next: BranchPickerNext,
});
