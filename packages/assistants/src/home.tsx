import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { HomePageWidgetBlueprint } from '@backstage/plugin-home-react/alpha';
import { z } from 'zod';
import type { AssistantComposerVariant } from './home/AssistantComposer';

export { AssistantComposer } from './home/AssistantComposer';
export type { AssistantComposerVariant } from './home/AssistantComposer';

/** Grid rows each variant needs (the home grid's row is 60 px). */
const ROWS: Record<AssistantComposerVariant, number> = {
  bar: 2,
  padded: 3,
  full: 3,
  titled: 4,
};

/**
 * The homepage composer on a `@backstage/plugin-home` home page: one widget,
 * `AssistantComposer`, whose look is set in app-config. Sending opens the
 * panel on the new conversation; without the panel it opens on the
 * Assistants page.
 *
 * Its own entry point, so `@backstage/plugin-home-react` (an optional peer)
 * is loaded only by an app that uses it:
 *
 * ```ts
 * import { assistantsHomeModule } from '@drewswiredin/backstage-plugin-assistants/home';
 * createApp({ features: [assistantsPlugin, assistantsPanelModule, assistantsHomeModule] });
 * ```
 *
 * ```yaml
 * app:
 *   extensions:
 *     - home-page-widget:assistants/AssistantComposer:
 *         config:
 *           variant: bar # bar | padded | full | titled
 *           title: Ask the assistant # titled only
 *           width: 100 # % of the card; bar 100, others 80 by default
 *     - page:home:
 *         config:
 *           defaultConfig:
 *             - component: AssistantComposer
 *               column: 0
 *               row: 0
 *               width: 12
 *               height: 2 # bar 2, padded 3, full 3, titled 4
 * ```
 *
 * @public
 */
export const assistantsHomeModule = createFrontendModule({
  pluginId: 'assistants',
  extensions: [
    HomePageWidgetBlueprint.makeWithOverrides({
      name: 'AssistantComposer',
      configSchema: {
        variant: z.enum(['bar', 'padded', 'full', 'titled']).default('padded'),
        title: z.string().default('Ask the assistant'),
        width: z.number().min(20).max(100).optional(),
      },
      factory(originalFactory, { config }) {
        const variant = config.variant as AssistantComposerVariant;
        const rows = ROWS[variant];
        return originalFactory({
          // The grid's key for `defaultConfig` and the widget picker.
          name: 'AssistantComposer',
          // Only the titled variant has a card header.
          title: variant === 'titled' ? config.title : undefined,
          description: 'Ask the assistant: a question answered in the panel.',
          components: () =>
            import('./home/AssistantComposer').then(m => ({
              Content: () => (
                <m.AssistantComposer variant={variant} width={config.width} />
              ),
            })),
          layout: {
            width: { minColumns: 4, defaultColumns: 12 },
            height: { minRows: rows, maxRows: rows, defaultRows: rows },
          },
        });
      },
    }),
  ],
});
