import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { HomePageWidgetBlueprint } from '@backstage/plugin-home-react/alpha';

/**
 * The homepage composer on the `@backstage/plugin-home` home page: the
 * panel's header (the assistant, with a menu to pick another) and the same
 * composer as the page and the panel, with the model and reasoning effort
 * pickers, but no conversation. Sending opens the panel on a fresh
 * conversation with everything already chosen, so the card is a way in, not
 * a second chat; without the panel it takes the question to the Assistants
 * page.
 *
 * Its own entry point, so `@backstage/plugin-home-react` (an optional peer)
 * is loaded only by an app that uses it:
 *
 * ```ts
 * import { assistantsHomeModule } from '@drewswiredin/backstage-plugin-assistants/home';
 * createApp({ features: [assistantsPlugin, assistantsPanelModule, assistantsHomeModule] });
 * ```
 *
 * The widget is `home-page-widget:assistants/AskAssistant`; the home page's
 * grid places it by name:
 *
 * ```yaml
 * app:
 *   extensions:
 *     - page:home:
 *         config:
 *           defaultConfig:
 *             - component: AskAssistant
 *               column: 0
 *               row: 0
 *               width: 6
 *               height: 4
 * ```
 *
 * @public
 */
export const assistantsHomeModule = createFrontendModule({
  pluginId: 'assistants',
  extensions: [
    HomePageWidgetBlueprint.make({
      name: 'AskAssistant',
      params: {
        // The grid's key for `defaultConfig` and the widget picker (the
        // extension name above is not used for that).
        name: 'AskAssistant',
        // No title: the composer renders without a card header, the way the
        // panel has none. The description names it in the widget picker.
        description: 'Ask the assistant: a question answered in the panel.',
        components: () =>
          import('./home/AskAssistantCard').then(m => ({
            Content: () => <m.AskAssistantCard />,
          })),
        layout: {
          width: { minColumns: 4, defaultColumns: 12 },
          height: { minRows: 3, maxRows: 3, defaultRows: 3 },
        },
      },
    }),
  ],
});
