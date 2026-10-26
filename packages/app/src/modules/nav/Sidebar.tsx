import {
  Sidebar,
  SidebarDivider,
  SidebarGroup,
  SidebarItem,
  SidebarScrollWrapper,
  SidebarSpace,
} from '@backstage/core-components';
import { NavContentBlueprint } from '@backstage/plugin-app-react';
import type { ReactNode } from 'react';
import { SidebarLogo } from './SidebarLogo';
import MenuIcon from '@material-ui/icons/Menu';
import SearchIcon from '@material-ui/icons/Search';
import { SidebarSearchModal } from '@backstage/plugin-search';
import { UserSettingsSignInAvatar } from '@backstage/plugin-user-settings';
import { NotificationsSidebarItem } from '@backstage/plugin-notifications';
import { usePermission } from '@backstage/plugin-permission-react';
import { assistantUsePermission } from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * Shows the Assistants nav entry only to users who hold the `assistant.use`
 * permission. Hidden entirely otherwise — no nav entry, no error-on-click.
 */
function IfAssistantsAllowed({ children }: { children: ReactNode }) {
  const { allowed } = usePermission({ permission: assistantUsePermission });
  return allowed ? <>{children}</> : null;
}

export const SidebarContent = NavContentBlueprint.make({
  params: {
    component: ({ navItems }) => {
      const nav = navItems.withComponent(item => (
        <SidebarItem icon={() => item.icon} to={item.href} text={item.title} />
      ));

      // Skipped items
      nav.take('page:search'); // Using search modal instead
      nav.take('page:notifications'); // NotificationsSidebarItem below
      nav.take('page:catalog-import'); // Reached from Create
      // The plugin's entry (its icon carries the working/unread dot),
      // placed below behind the permission check.
      const assistants = nav.take('page:assistants');

      return (
        <Sidebar>
          <SidebarLogo />
          <SidebarGroup label="Search" icon={<SearchIcon />} to="/search">
            <SidebarSearchModal />
          </SidebarGroup>
          <SidebarDivider />
          <SidebarGroup label="Menu" icon={<MenuIcon />}>
            {nav.take('page:home')}
            <IfAssistantsAllowed>{assistants}</IfAssistantsAllowed>
            <SidebarDivider />
            {nav.take('page:catalog')}
            {nav.take('page:api-docs')}
            {nav.take('page:techdocs')}
            {nav.take('page:catalog-graph')}
            <SidebarDivider />
            {nav.take('page:scaffolder')}
            <SidebarScrollWrapper>
              {nav.rest({ sortBy: 'title' })}
            </SidebarScrollWrapper>
          </SidebarGroup>
          <SidebarSpace />
          <SidebarDivider />
          <NotificationsSidebarItem />
          <SidebarDivider />
          <SidebarGroup
            label="Settings"
            icon={<UserSettingsSignInAvatar />}
            to="/settings"
          >
            {nav.take('page:app-visualizer')}
            {nav.take('page:user-settings')}
          </SidebarGroup>
        </Sidebar>
      );
    },
  },
});
