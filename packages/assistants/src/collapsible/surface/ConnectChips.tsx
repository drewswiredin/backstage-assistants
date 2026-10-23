import Chip from '@material-ui/core/Chip';
import LinkIcon from '@material-ui/icons/Link';
import type { AssistantId } from '@drewswiredin/backstage-plugin-assistants-common';
import { useToolGuards, useUnconnectedServers } from '../toolGuards';

/**
 * A "Connect GitHub" chip per per-user server the user hasn't connected:
 * its tools are offered only with the user's own sign-in. Clicking opens
 * the provider's sign-in popup; the chip goes away once connected.
 */
export function ConnectChips({
  assistantId,
}: {
  assistantId: AssistantId | undefined;
}) {
  const { connect } = useToolGuards();
  const missing = useUnconnectedServers(assistantId);
  if (missing.length === 0) return null;
  return (
    <>
      {missing.map(spec => (
        <Chip
          key={spec.server}
          size="small"
          variant="outlined"
          color="primary"
          icon={<LinkIcon />}
          label={`Connect ${spec.title}`}
          title={`Sign in to ${spec.title} so the assistant can use its tools as you`}
          onClick={() => void connect(spec)}
        />
      ))}
    </>
  );
}
