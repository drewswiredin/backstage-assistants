import {
  Sidebar,
  SidebarDivider,
  SidebarGroup,
  SidebarItem,
  SidebarScrollWrapper,
  SidebarSpace,
} from '@backstage/core-components';
import { NavContentBlueprint } from '@backstage/plugin-app-react';
import { SidebarLogo } from './SidebarLogo';
import MenuIcon from '@material-ui/icons/Menu';
import SearchIcon from '@material-ui/icons/Search';
import { SidebarSearchModal } from '@backstage/plugin-search';
import { UserSettingsSignInAvatar } from '@backstage/plugin-user-settings';
import { NotificationsSidebarItem } from '@backstage/plugin-notifications';
import { AssistantsNavIcon } from '@drewswiredin/backstage-plugin-assistants';
import { usePermission } from '@backstage/plugin-permission-react';
import { assistantUsePermission } from '@drewswiredin/backstage-plugin-assistants-common';

/**
 * The Assistants nav item, shown only to users who hold the `assistant.use`
 * permission. Hidden entirely otherwise — no nav entry, no error-on-click.
 */
function AssistantsSidebarItem() {
  const { allowed } = usePermission({ permission: assistantUsePermission });
  if (!allowed) {
    return null;
  }
  return (
    <SidebarItem
      icon={() => <AssistantsNavIcon />}
      to="/assistants"
      text="Assistants"
    />
  );
}

export const SidebarContent = NavContentBlueprint.make({
  params: {
    component: ({ navItems }) => {
      const nav = navItems.withComponent(item => (
        <SidebarItem icon={() => item.icon} to={item.href} text={item.title} />
      ));

      // Skipped items
      nav.take('page:search'); // Using search modal instead
      // The Assistants page renders via a custom hover-submenu nav item below;
      // consume the auto-generated entry so it doesn't duplicate.
      nav.take('page:assistants');

      return (
        <Sidebar>
          <SidebarLogo />
          <SidebarGroup label="Search" icon={<SearchIcon />} to="/search">
            <SidebarSearchModal />
          </SidebarGroup>
          <SidebarDivider />
          <SidebarGroup label="Menu" icon={<MenuIcon />}>
            {nav.take('page:catalog')}
            {nav.take('page:scaffolder')}
            <AssistantsSidebarItem />
            <SidebarDivider />
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
