import { useEffect, useState } from 'react';
import { useApi, IconComponent } from '@backstage/core-plugin-api';
import {
  SidebarItem,
  SidebarSubmenu,
  SidebarSubmenuItem,
} from '@backstage/core-components';
import ForumOutlinedIcon from '@material-ui/icons/ForumOutlined';
import { assistantsApiRef } from '@drewswiredin/backstage-plugin-assistants';
import { AssistantSummary } from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * Loads the browser-safe assistant list once for the nav. Failures (e.g. signed
 * out) collapse to an empty list — the nav item still renders and links to the
 * page, which surfaces the real error.
 */
function useAssistants(): AssistantSummary[] {
  const api = useApi(assistantsApiRef);
  const [assistants, setAssistants] = useState<AssistantSummary[]>([]);
  useEffect(() => {
    let active = true;
    api
      .getStatus()
      .then(status => active && setAssistants(status.assistants))
      .catch(() => active && setAssistants([]));
    return () => {
      active = false;
    };
  }, [api]);
  return assistants;
}

/** A small 'B' avatar tinted by the assistant's configured brand color. */
const makeAssistantIcon =
  (color?: string): IconComponent =>
  function AssistantIcon() {
    return (
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: color ?? '#5b6675',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        B
      </span>
    );
  };

/**
 * A single Assistants nav entry whose hover submenu lists every accessible
 * assistant. Selecting one navigates to the given chrome page with the
 * assistant pre-selected (`?assistant=<id>`); assistant choice thus lives in the
 * nav, not inside the chat. Rendered once per shipped chrome (A and B).
 */
export function AssistantsNavItem(props: { to: string; text: string }) {
  const assistants = useAssistants();
  return (
    <SidebarItem icon={ForumOutlinedIcon} to={props.to} text={props.text}>
      <SidebarSubmenu title={props.text}>
        {assistants.map(a => (
          <SidebarSubmenuItem
            key={a.id}
            title={a.title}
            to={`${props.to}?assistant=${encodeURIComponent(a.id)}`}
            icon={makeAssistantIcon(a.color)}
          />
        ))}
      </SidebarSubmenu>
    </SidebarItem>
  );
}
