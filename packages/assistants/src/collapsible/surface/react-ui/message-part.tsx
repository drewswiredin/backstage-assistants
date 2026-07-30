// Vendored from @assistant-ui/react-ui@0.2.1 `message-part.tsx` (see
// withDefaults.tsx for why).
import { MessagePartPrimitive, INTERNAL } from '@assistant-ui/react';
import classNames from 'classnames';

const { useSmoothStatus, withSmoothContextProvider } = INTERNAL;

const Text = () => {
  const status = useSmoothStatus();
  return (
    <MessagePartPrimitive.Text
      className={classNames(
        'aui-text',
        status.type === 'running' && 'aui-text-running',
      )}
      component="p"
    />
  );
};

export const MessagePart = {
  Text: withSmoothContextProvider(Text),
};
