import Chip from '@material-ui/core/Chip';
import CheckIcon from '@material-ui/icons/Check';
import LinkIcon from '@material-ui/icons/Link';
import type { AssistantId } from '@drewswiredin/backstage-plugin-assistants-common';
import {
  useConnectedOAuthServers,
  useToolGuards,
  useUnconnectedServers,
} from '../toolGuards';

/**
 * A "Connect GitHub" chip per per-user server the user hasn't connected:
 * its tools are offered only with the user's own sign-in. Clicking opens
 * the provider's sign-in popup; the chip goes away once connected.
 *
 * A server that runs its own OAuth keeps the sign-in on the backend, so once
 * connected it shows a quiet "✓ Atlassian" chip whose × disconnects.
 */
export function ConnectChips({
  assistantId,
}: {
  assistantId: AssistantId | undefined;
}) {
  const { connect, disconnect, oauthConnections } = useToolGuards();
  const missing = useUnconnectedServers(assistantId);
  const connected = useConnectedOAuthServers(assistantId);
  if (missing.length === 0 && connected.length === 0) return null;
  return (
    <>
      {missing.map(spec => {
        const expired = oauthConnections[spec.server] === 'expired';
        return (
          <Chip
            key={spec.server}
            size="small"
            variant="outlined"
            color="primary"
            icon={<LinkIcon />}
            label={`${expired ? 'Reconnect' : 'Connect'} ${spec.title}`}
            title={
              expired
                ? `Your ${spec.title} sign-in expired; sign in again so the assistant can use its tools as you`
                : `Sign in to ${spec.title} so the assistant can use its tools as you`
            }
            onClick={() => void connect(spec)}
          />
        );
      })}
      {connected.map(spec => (
        <Chip
          key={spec.server}
          size="small"
          variant="outlined"
          icon={<CheckIcon />}
          label={spec.title}
          title={`Connected: the assistant uses ${spec.title} as you. × disconnects.`}
          onDelete={() => void disconnect(spec)}
        />
      ))}
    </>
  );
}
