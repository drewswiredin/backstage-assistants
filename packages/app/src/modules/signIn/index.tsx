import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';

/**
 * Overrides the app's default sign-in page (extension `sign-in-page:app`) with
 * the dev multi-user picker — same override mechanism the nav module uses for
 * `nav-content:app`.
 */
const signInPage = SignInPageBlueprint.make({
  params: {
    loader: async () => {
      const { SignInPicker } = await import('./SignInPicker');
      return SignInPicker;
    },
  },
});

export const signInModule = createFrontendModule({
  pluginId: 'app',
  extensions: [signInPage],
});
