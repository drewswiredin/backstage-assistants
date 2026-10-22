import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { HomePageWidgetBlueprint } from '@backstage/plugin-home-react/alpha';
import {
  AssistantComposer,
  type AssistantComposerVariant,
} from '@drewswiredin/backstage-plugin-assistants/home';

/**
 * The other three looks of the homepage composer, next to the plugin's own
 * widget (configured as `padded`), so the docs screenshot shows all four.
 * An app needs one; this dev app shows them side by side.
 */
function variantWidget(
  variant: AssistantComposerVariant,
  rows: number,
  title?: string,
) {
  const name = `AssistantComposer-${variant}`;
  return HomePageWidgetBlueprint.make({
    name,
    params: {
      name,
      title,
      description: `Assistant composer (${variant})`,
      components: async () => ({
        Content: () => <AssistantComposer variant={variant} />,
      }),
      layout: {
        width: { minColumns: 4, defaultColumns: 12 },
        height: { minRows: rows, maxRows: rows, defaultRows: rows },
      },
    },
  });
}

export const homeVariantsModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    variantWidget('bar', 2),
    variantWidget('full', 3),
    variantWidget('titled', 4, 'Ask the assistant'),
  ],
});
