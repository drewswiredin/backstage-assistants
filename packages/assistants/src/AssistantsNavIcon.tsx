import { RiRobot2Line } from '@remixicon/react';
import { useApi } from '@backstage/core-plugin-api';
import { assistantsApiRef } from './api';
import { useThreadStatus } from './collapsible/useThreadStatus';
import { StatusDot } from './collapsible/StatusDot';

/**
 * The Assistants nav-rail icon with a live status dot: amber pulsing if any
 * conversation (across all assistants) is working, else solid red if any is
 * unread, else nothing — working wins. Shown on every Backstage page (it's a
 * sidebar item), and derived from the same server status snapshot as the in-page
 * indicators, so they never disagree.
 *
 * @public
 */
export function AssistantsNavIcon() {
  const api = useApi(assistantsApiRef);
  // No focused conversation in the nav context, so pass undefined.
  const { overallStatus } = useThreadStatus(api, undefined);

  return (
    <StatusDot status={overallStatus}>
      <RiRobot2Line />
    </StatusDot>
  );
}
